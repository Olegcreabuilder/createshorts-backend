import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';
import { Resend } from 'resend';
import cron from 'node-cron';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true, // Accepte toutes les origines en développement
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Initialisation Supabase avec SERVICE_ROLE_KEY
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // ⚠️ Service Role Key côté serveur
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Template HTML de l'email promo
const getPromoEmailHTML = (firstName) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td align="center" style="padding: 40px 40px 20px 40px;">
              <img src="https://app.createshorts.io/createshorts-black.png" alt="CreateShorts" style="height: 32px; width: auto;">
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 40px 40px;">
              <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 20px 0;">
                ${firstName ? `Salut ${firstName},` : 'Salut,'}
              </p>
              <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 20px 0;">
                Actuellement, tu es sur l'essai gratuit de <a href="https://app.createshorts.io" style="color: #7c3aed; text-decoration: none; font-weight: 600;">CreateShorts</a>.
              </p>
              <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 20px 0;">
                Malheureusement, celui-ci n'est pas éternel.
              </p>
              <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 20px 0;">
                Pour que tu puisses continuer à progresser vers la viralité, nous avons pensé à toi.
              </p>
              <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 10px 0;">
                Bénéficie dès aujourd'hui de <strong style="color: #059669;">-99% sur ton 1er mois d'abonnement</strong> avec le code suivant :
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <span style="font-size: 28px; font-weight: 800; color: #111827; letter-spacing: 2px;">
                  CREATESHORTS1
                </span>
              </div>
              <p style="font-size: 15px; color: #6b7280; line-height: 1.6; margin: 0 0 20px 0; font-style: italic;">
                C'est un code que je t'ai fait spécialement, ne le partage à personne d'autre.
              </p>
              <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 30px 0;">
                Profites-en dès maintenant :
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://app.createshorts.io/upgrade" 
                   style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: #ffffff; text-decoration: none; font-weight: 700; font-size: 16px; padding: 16px 40px; border-radius: 8px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);">
                  J'UTILISE LE CODE
                </a>
              </div>
              <div style="background-color: #f3f4f6; border-radius: 8px; padding: 20px; margin-top: 30px;">
                <p style="font-size: 14px; font-weight: 600; color: #374151; margin: 0 0 15px 0;">
                  ✨ Ce que tu débloques avec le Plan Pro :
                </p>
                <ul style="margin: 0; padding-left: 20px; color: #6b7280; font-size: 14px; line-height: 1.8;">
                  <li>Analyse complète de ton compte TikTok</li>
                  <li>Idées de contenu viral illimitées</li>
                  <li>Analyse de tes vidéos par l'IA</li>
                  <li>Plan d'action personnalisé</li>
                  <li>Suivi de tes performances</li>
                </ul>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 40px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="font-size: 13px; color: #9ca3af; margin: 0 0 10px 0;">
                Tu reçois cet email car tu t'es inscrit sur CreateShorts.
              </p>
              <p style="font-size: 13px; color: #9ca3af; margin: 0;">
                © 2025 CreateShorts. Tous droits réservés.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Fonction pour envoyer un email promo
async function sendPromoEmail(to, firstName) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'CreateShorts <noreply@createshorts.io>',
      to: to,
      subject: 'Ton essai CreateShorts va prendre fin',
      html: getPromoEmailHTML(firstName),
    });

    if (error) {
      console.error('❌ Erreur envoi email:', error);
      return { success: false, error };
    }

    console.log('✅ Email promo envoyé à:', to);
    return { success: true, id: data.id };
  } catch (error) {
    console.error('❌ Exception envoi email:', error);
    return { success: false, error: error.message };
  }
}

// ============================================
// CRON JOB : Emails automatiques 1h après inscription
// Tourne toutes les 15 minutes
// ============================================
cron.schedule('*/15 * * * *', async () => {
  console.log('⏰ [CRON] Vérification des emails à envoyer...');

  try {
    // Chercher les users "free" inscrits il y a environ 1h (entre 55min et 75min)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1h
    const buffer = new Date(Date.now() - 75 * 60 * 1000); // 1h15

    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, email, first_name, created_at, promo_email_sent')
      .eq('role', 'free')
      .is('promo_email_sent', null)
      .gte('created_at', buffer.toISOString())
      .lte('created_at', oneHourAgo.toISOString());

    if (error) {
      console.error('❌ [CRON] Erreur requête:', error);
      return;
    }

    if (!users || users.length === 0) {
      console.log('📭 [CRON] Aucun email à envoyer');
      return;
    }

    console.log(`📧 [CRON] ${users.length} email(s) à envoyer`);

    for (const user of users) {
      // Envoyer l'email
      const result = await sendPromoEmail(user.email, user.first_name);

      if (result.success) {
        // Marquer comme envoyé
        await supabase
          .from('profiles')
          .update({ promo_email_sent: new Date().toISOString() })
          .eq('id', user.id);

        console.log(`✅ [CRON] Email envoyé à ${user.email}`);
      } else {
        console.error(`❌ [CRON] Échec pour ${user.email}`);
      }

      // Attendre 1 seconde entre chaque email (éviter rate limit)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('✅ [CRON] Terminé');

  } catch (error) {
    console.error('❌ [CRON] Exception:', error);
  }
});

console.log('✅ Cron job emails automatiques activé (toutes les 15 minutes)');


// 3. AJOUTER CETTE ROUTE POUR RELANCER TOUTE LA BASE
// --------------------------------------------------

// ============================================
// ROUTE : POST /api/send-bulk-promo-emails
// Envoie l'email promo à tous les users "free" qui ne l'ont pas reçu
// ⚠️ PROTÉGÉE PAR CLÉ ADMIN
// ============================================
app.post('/api/send-bulk-promo-emails', async (req, res) => {
  try {
    const { adminKey } = req.body;

    // Vérification clé admin
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    console.log('🚀 [BULK] Démarrage envoi emails en masse...');

    // Récupérer tous les users "free" qui n'ont pas reçu l'email
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, email, first_name')
      .eq('role', 'free')
      .is('promo_email_sent', null);

    if (error) {
      console.error('❌ [BULK] Erreur requête:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!users || users.length === 0) {
      return res.json({ message: 'Aucun utilisateur à contacter', sent: 0 });
    }

    console.log(`📧 [BULK] ${users.length} utilisateur(s) à contacter`);

    let sent = 0;
    let failed = 0;
    const results = [];

    for (const user of users) {
      const result = await sendPromoEmail(user.email, user.first_name);

      if (result.success) {
        // Marquer comme envoyé
        await supabase
          .from('profiles')
          .update({ promo_email_sent: new Date().toISOString() })
          .eq('id', user.id);

        sent++;
        results.push({ email: user.email, status: 'sent' });
      } else {
        failed++;
        results.push({ email: user.email, status: 'failed', error: result.error });
      }

      // Attendre 1 seconde entre chaque email
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ [BULK] Terminé - Envoyés: ${sent}, Échoués: ${failed}`);

    res.json({
      message: 'Envoi terminé',
      total: users.length,
      sent,
      failed,
      results
    });

  } catch (error) {
    console.error('❌ [BULK] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================
// ROUTE : POST /api/test-promo-email
// Envoie un email de test
// ============================================
app.post('/api/test-promo-email', async (req, res) => {
  try {
    const { email, firstName, adminKey } = req.body;

    // Vérification clé admin
    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }

    console.log('🧪 [TEST] Envoi email de test à:', email);

    const result = await sendPromoEmail(email, firstName || 'Testeur');

    if (result.success) {
      res.json({ success: true, message: 'Email de test envoyé', id: result.id });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }

  } catch (error) {
    console.error('❌ [TEST] Exception:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/preview-promo-email', (req, res) => {
  const firstName = req.query.name || 'Testeur';
  res.send(getPromoEmailHTML(firstName));
});






// Initialisation OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// ROUTE : POST /api/connect-tiktok
// ============================================
app.post('/api/connect-tiktok', async (req, res) => {
  try {
    console.log('🎯 Début de la route /api/connect-tiktok');
    console.log('📦 Body reçu:', req.body);
    const { username, userToken } = req.body; // userToken = JWT de Supabase

    if (!username) {
      return res.status(400).json({ error: 'Username requis' });
    }

    // Vérifier l'authentification
    const { data: { user }, error: authError } = await supabase.auth.getUser(userToken);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log(`🔍 Récupération du compte TikTok: @${username}`);

    // 1. Récupérer les infos du compte via RapidAPI
    const userInfo = await fetchTikTokUserInfo(username);

    if (!userInfo) {
      return res.status(404).json({ error: 'Compte TikTok introuvable' });
    }

    console.log(`✅ Compte trouvé: ${userInfo.followerCount} followers`);

    // 2. Récupérer les dernières vidéos pour analyse
    const userVideos = await fetchTikTokUserVideos(username);

    console.log(`📹 ${userVideos.length} vidéos récupérées`);

    // 3. Analyser le compte avec l'IA
    const aiAnalysis = await analyzeAccountWithAI(userInfo, userVideos);

    console.log('🤖 Analyse IA terminée');

    // 4. Calculer les statistiques (AVEC TOUTES LES NOUVELLES STATS)
    const stats = calculateStats(userInfo, userVideos);

    // ⭐ EXTRACTION DES STATS POUR LA BDD
    const { 
      viralityScore, 
      viralityLabel, 
      growthPotential, 
      growthLabel,
      growthColor,
      engagementRate,
      avgViews,
      avgLikes,        // ⭐ AJOUT avg_likes
      ...otherStats 
    } = stats;

    console.log('📊 Stats calculées:', {
      viralityScore,
      viralityLabel,
      growthPotential,
      growthLabel,
      growthColor,
      engagementRate,
      avgViews,
      avgLikes         // ⭐ Log avg_likes
    });

    console.log('💾 Données à sauvegarder:', {
      username,
      avatar_url: userInfo.avatarLarger || userInfo.avatarMedium,
      followers_count: userInfo.followerCount,
      following_count: userInfo.followingCount,
      total_likes: userInfo.heartCount,
      video_count: userInfo.videoCount,
      virality_score: viralityScore,
      growth_potential: growthPotential,
      engagement_rate: engagementRate,
      avg_views: avgViews,
      avg_likes: avgLikes  // ⭐ Log avg_likes
    });

    // 5. Sauvegarder dans Supabase (AVEC LES NOUVELLES COLONNES)
    const { data: savedAccount, error: dbError } = await supabase
      .from('connected_accounts')
      .upsert({
        user_id: user.id,
        tiktok_username: username,
        tiktok_user_id: userInfo.id,
        display_name: userInfo.nickname,
        avatar_url: userInfo.avatarLarger || userInfo.avatarMedium,
        bio: userInfo.signature,
        followers_count: userInfo.followerCount,
        following_count: userInfo.followingCount,
        total_likes: userInfo.heartCount,
        video_count: userInfo.videoCount,
        verified: userInfo.verified || false,
        
        // ⭐ AJOUT DES NOUVELLES COLONNES
        virality_score: viralityScore,
        virality_label: viralityLabel,
        growth_potential: growthPotential,
        growth_label: growthLabel,
        growth_color: growthColor,
        engagement_rate: engagementRate,
        avg_views: avgViews,
        avg_likes: avgLikes,  // ⭐ SAUVEGARDE avg_likes
        
        niche: aiAnalysis.niche,
        account_summary: aiAnalysis.resume,
        strengths: aiAnalysis.points_forts,
        weaknesses: aiAnalysis.points_faibles,
        recommendations: aiAnalysis.recommandations,
        stats: otherStats, // Les autres stats (avgComments, avgShares, etc.)
        last_sync: new Date().toISOString(),
        is_connected: true,
      }, {
        onConflict: 'user_id',
      });

    if (dbError) {
      console.error('Erreur DB:', dbError);
      throw new Error('Erreur lors de la sauvegarde');
    }

    console.log('💾 Compte sauvegardé en base de données');

    // 6. Retourner au frontend (AVEC LES NOUVELLES STATS)
    return res.status(200).json({
      success: true,
      account: {
        username,
        displayName: userInfo.nickname,
        avatarUrl: userInfo.avatarLarger,
        followers: userInfo.followerCount,
        following: userInfo.followingCount,
        totalLikes: userInfo.heartCount,
        videoCount: userInfo.videoCount,
        bio: userInfo.signature,
        verified: userInfo.verified,
        
        // ⭐ AJOUT DES NOUVELLES STATS
        viralityScore,
        viralityLabel,
        growthPotential,
        growthLabel,
        growthColor,
        engagementRate,
        avgViews,
        avgLikes,        // ⭐ RETOUR avg_likes au frontend
        
        niche: aiAnalysis.niche,
        analysis: aiAnalysis,
        stats: otherStats,
      },
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({ 
      error: error.message || 'Erreur lors de la connexion du compte' 
    });
  }
});

// ============================================
// FONCTIONS TIKTOK AVEC FALLBACK RAPIDAPI
// ============================================

// Fonction pour récupérer les infos du compte via API TikWM (gratuite) avec fallback RapidAPI
async function fetchTikTokUserInfo(username) {
  // 1. ESSAYER TIKWM D'ABORD (gratuit)
  try {
    console.log('🔧 Tentative avec API TikWM (gratuite)...');
    console.log('📝 Username:', username);
    
    const url = `https://www.tikwm.com/api/user/info?unique_id=${username}`;
    
    console.log('📡 Envoi requête à TikWM...');
    const response = await axios.get(url, { timeout: 10000 });
    
    console.log('✅ Réponse reçue, status:', response.status);
    
    if (response.data && response.data.data && response.data.data.user) {
      const userData = response.data.data;
      console.log('✅ TikWM - Utilisateur trouvé:', userData.user.nickname);
      
      return {
        id: userData.user.id,
        uniqueId: userData.user.unique_id || username,
        nickname: userData.user.nickname,
        avatarLarger: userData.user.avatarLarger,
        avatarMedium: userData.user.avatarMedium,
        signature: userData.user.signature,
        followerCount: userData.stats?.followerCount || userData.stats?.follower_count || 0,
        followingCount: userData.stats?.followingCount || userData.stats?.following_count || 0,
        heartCount: userData.stats?.heartCount || userData.stats?.heart_count || 0,
        videoCount: userData.stats?.videoCount || userData.stats?.video_count || 0,
        verified: userData.user.verified || false
      };
    }
    
    console.log('❌ TikWM - Pas de données utilisateur, tentative RapidAPI...');
    throw new Error('Pas de données TikWM');
    
  } catch (tikwmError) {
    console.error('❌ Erreur TikWM:', tikwmError.message);
    console.log('🔄 Fallback vers RapidAPI...');
    
    // 2. FALLBACK RAPIDAPI
    return await fetchTikTokUserInfoRapidAPI(username);
  }
}

// Fonction RapidAPI pour récupérer les infos utilisateur
async function fetchTikTokUserInfoRapidAPI(username) {
  try {
    console.log('🔧 Tentative avec RapidAPI...');
    
    const options = {
      method: 'GET',
      url: 'https://tiktok-scraper7.p.rapidapi.com/user/info',
      params: { unique_id: username },
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
      },
      timeout: 15000
    };

    const response = await axios.request(options);
    
    console.log('✅ RapidAPI - Réponse reçue');
    
    if (response.data && response.data.data && response.data.data.user) {
      const userData = response.data.data;
      console.log('✅ RapidAPI - Utilisateur trouvé:', userData.user.nickname);
      
      return {
        id: userData.user.id,
        uniqueId: userData.user.uniqueId || username,
        nickname: userData.user.nickname,
        avatarLarger: userData.user.avatarLarger || userData.user.avatarMedium,
        avatarMedium: userData.user.avatarMedium,
        signature: userData.user.signature,
        followerCount: userData.stats?.followerCount || 0,
        followingCount: userData.stats?.followingCount || 0,
        heartCount: userData.stats?.heartCount || userData.stats?.heart || 0,
        videoCount: userData.stats?.videoCount || 0,
        verified: userData.user.verified || false
      };
    }
    
    console.log('❌ RapidAPI - Pas de données utilisateur');
    return null;
    
  } catch (error) {
    console.error('❌ Erreur RapidAPI:', error.message);
    if (error.response) {
      console.error('📋 Status:', error.response.status);
      console.error('📋 Data:', JSON.stringify(error.response.data).substring(0, 300));
    }
    throw new Error('Impossible de récupérer les infos du compte (TikWM et RapidAPI ont échoué)');
  }
}

// Fonction pour récupérer les vidéos d'un utilisateur via TikWM avec fallback RapidAPI
async function fetchTikTokUserVideos(username, maxVideos = 10) {
  // 1. ESSAYER TIKWM D'ABORD (gratuit)
  try {
    const url = `https://www.tikwm.com/api/user/posts?unique_id=${username}&count=${maxVideos}`;
    
    console.log('📡 TikWM - Récupération des vidéos...');
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data && response.data.data && response.data.data.videos) {
      console.log('✅ TikWM - Vidéos trouvées:', response.data.data.videos.length);
      return response.data.data.videos;
    }
    
    console.log('⚠️ TikWM - Pas de vidéos, tentative RapidAPI...');
    throw new Error('Pas de vidéos TikWM');
    
  } catch (tikwmError) {
    console.error('❌ Erreur TikWM vidéos:', tikwmError.message);
    console.log('🔄 Fallback vers RapidAPI pour les vidéos...');
    
    // 2. FALLBACK RAPIDAPI
    return await fetchTikTokUserVideosRapidAPI(username, maxVideos);
  }
}

// Fonction RapidAPI pour récupérer les vidéos utilisateur
async function fetchTikTokUserVideosRapidAPI(username, maxVideos = 10) {
  try {
    console.log('🔧 RapidAPI - Récupération des vidéos...');
    
    const options = {
      method: 'GET',
      url: 'https://tiktok-scraper7.p.rapidapi.com/user/posts',
      params: { 
        unique_id: username,
        count: maxVideos.toString()
      },
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
      },
      timeout: 15000
    };

    const response = await axios.request(options);
    
    if (response.data && response.data.data && response.data.data.videos) {
      const videos = response.data.data.videos;
      console.log('✅ RapidAPI - Vidéos trouvées:', videos.length);
      
      // Adapter le format RapidAPI au format attendu (similaire à TikWM)
      return videos.map(v => ({
        video_id: v.video_id || v.id,
        title: v.title || v.desc || '',
        cover: v.cover || v.origin_cover,
        duration: v.duration,
        play_count: v.play_count || v.playCount || 0,
        digg_count: v.digg_count || v.diggCount || 0,
        comment_count: v.comment_count || v.commentCount || 0,
        share_count: v.share_count || v.shareCount || 0,
        create_time: v.create_time || v.createTime
      }));
    }
    
    console.log('⚠️ RapidAPI - Pas de vidéos trouvées');
    return [];
    
  } catch (error) {
    console.error('❌ Erreur RapidAPI vidéos:', error.message);
    if (error.response) {
      console.error('📋 Status:', error.response.status);
    }
    return [];
  }
}

// Fonction pour analyser le compte avec l'IA
async function analyzeAccountWithAI(userInfo, videos) {
  try {
    const videosData = videos.slice(0, 10).map(v => ({
      titre: v.title || '',
      vues: v.play_count || 0,
      likes: v.digg_count || 0,
      commentaires: v.comment_count || 0,
      partages: v.share_count || 0,
    }));

    // ⭐ CALCULS POUR LE PROMPT
    const avgViews = videosData.length > 0 
      ? Math.round(videosData.reduce((sum, v) => sum + v.vues, 0) / videosData.length)
      : 0;
    
    const avgLikes = videosData.length > 0
      ? Math.round(videosData.reduce((sum, v) => sum + v.likes, 0) / videosData.length)
      : 0;

    const totalEngagement = videosData.reduce((sum, v) => sum + v.likes + v.commentaires + v.partages, 0);
    const totalViews = videosData.reduce((sum, v) => sum + v.vues, 0);
    const engagementRate = totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(1) : 0;

    const topVideos = [...videosData].sort((a, b) => b.vues - a.vues).slice(0, 3);
    const topViews = topVideos[0]?.vues || avgViews;

    const prompt = `Tu es un expert TikTok qui analyse des comptes de créateurs. Voici les données du compte @${userInfo.uniqueId} :

**STATISTIQUES GLOBALES :**
- Followers : ${userInfo.followerCount?.toLocaleString()}
- Total Likes : ${userInfo.heartCount?.toLocaleString()}
- Vidéos : ${userInfo.videoCount}
- Following : ${userInfo.followingCount?.toLocaleString()}
- Engagement Rate : ${engagementRate}%
- Vues moyennes : ${avgViews.toLocaleString()}
- Likes moyens : ${avgLikes.toLocaleString()}
- Bio : "${userInfo.signature || 'Aucune bio'}"

**NICHE DÉTECTÉE (si identifiable) :** À déterminer depuis les vidéos

**ANALYSE DES ${videosData.length} DERNIÈRES VIDÉOS :**
${videosData.map((v, i) => `${i+1}. "${v.titre.substring(0,60)}..." : ${v.vues.toLocaleString()} vues, ${v.likes.toLocaleString()} likes (${v.vues > 0 ? ((v.likes / v.vues) * 100).toFixed(1) : 0}% engagement)`).join('\n')}

**TOP 3 VIDÉOS :**
${topVideos.map((v, i) => `${i+1}. ${v.vues.toLocaleString()} vues, ${v.likes.toLocaleString()} likes`).join('\n')}

---

**MISSION : Rédige une analyse ultra-personnalisée du compte au format JSON.**

**Format de réponse attendu (JSON strict) :**
{
  "niche": "Titre court de la niche en 2-4 mots (ex: Lifestyle & Dance, Gaming & Tech, Beauty & Fashion)",
  "resume": "RÉSUMÉ EN 2 PARAGRAPHES SÉPARÉS PAR \\n\\n (voir instructions détaillées ci-dessous)",
  "points_forts": [
    "Point fort 1 - Description détaillée",
    "Point fort 2 - Description détaillée",
    "Point fort 3 - Description détaillée",
    "Point fort 4 - Description détaillée"
  ],
  "points_faibles": [
    "Point faible 1 - Description détaillée",
    "Point faible 2 - Description détaillée",
    "Point faible 3 - Description détaillée",
    "Point faible 4 - Description détaillée"
  ],
  "recommandations": [
    "Recommandation 1 - Action concrète et détaillée",
    "Recommandation 2 - Action concrète et détaillée",
    "Recommandation 3 - Action concrète et détaillée",
    "Recommandation 4 - Action concrète et détaillée"
  ]
}

---

**📝 INSTRUCTIONS POUR LE "resume" (TRÈS IMPORTANT) :**

Le "resume" doit contenir **EXACTEMENT 2 PARAGRAPHES** séparés par \\n\\n (double saut de ligne).

**PARAGRAPHE 1 - LES FORCES (120-150 mots) :**

Commence par une accroche percutante avec le prénom du créateur (extraire depuis nickname si possible, sinon utilise le username) :
- Ex: "${userInfo.nickname?.split(' ')[0] || userInfo.uniqueId}, tu es une machine à viralité avec ${(userInfo.followerCount/1000000).toFixed(1)}M de followers et ${(userInfo.heartCount/1000000).toFixed(0)}M de likes."

Enchaîne avec une analyse data-driven de ses métriques d'influence :
- Qualifie son statut : mega-influenceur (>10M), macro-influenceur (1-10M), créateur émergent (100K-1M), talent en devenir (<100K)
- Cite son engagement rate avec contexte : "engagement ${engagementRate >= 8 ? 'exceptionnel' : engagementRate >= 5 ? 'solide' : engagementRate >= 3 ? 'correct' : 'à améliorer'} à ${engagementRate}%"
- Identifie ses patterns de succès : formats, durées, types de contenu, collaborations détectées dans les titres
- Mentionne les codes TikTok maîtrisés : hooks, storytelling, trends, rythme
- Si bio multilingue ou titres multilingues : parle de portée internationale
- Parle d'audience fidèle si engagement élevé

Ton : admiratif mais factuel, avec des chiffres précis et des comparaisons percutantes.

**PARAGRAPHE 2 - LES AXES D'AMÉLIORATION (100-130 mots) :**

Commence par "Cependant" ou "Toutefois" pour marquer la transition.

Identifie les patterns d'inconsistance :
- Écarts de performance entre vidéos : "certaines vidéos ${topViews < avgViews * 5 ? 'stagnent' : 'explosent'} à ${Math.round(topViews/1000000)}M alors que d'autres ${avgViews < 1000000 ? 'peinent à dépasser ' + Math.round(avgViews/1000) + 'K' : 'tournent autour de ' + Math.round(avgViews/1000000) + 'M'}"
- Compare top performers vs moyenne : "l'écart révèle des patterns non optimisés"

Pointe 3-4 leviers d'optimisation concrets :
- "Tes hooks manquent de système reproductible" (si variance importante dans les vues)
- "L'absence de hashtags stratégiques limite ta découvrabilité algorithmique" (si peu de hashtags détectés)
- "Ton storytelling pourrait être plus structuré pour garantir la rétention" (si engagement faible)
- "Teste des formats plus courts/longs selon tes top performers" (si durées variées)

Termine sur une vision motivante :
- "Tu as le talent mais pas encore la machine de guerre éditoriale pour garantir ${Math.round(topViews/1000000)}M+ sur chaque post."

Ton : coach constructif et actionnable, qui pousse à l'amélioration sans démotiver.

---

**STYLE GÉNÉRAL DU RÉSUMÉ :**
- Tutoiement direct ("tu", "tes", "ton")
- Vocabulaire TikTok natif (viralité, hooks, découvrabilité algorithmique, rétention, formats)
- Chiffres précis et arrondis intelligemment (18.3M, pas 18,342,567)
- Comparaisons percutantes ("X fois plus", "écart de 10x entre top et flop")
- Ton expert/coach, ni trop flatteur ni trop critique
- **PAS DE BULLET POINTS**, uniquement 2 paragraphes fluides en prose

**INTERDICTIONS ABSOLUES POUR LE RÉSUMÉ :**
- Ne commence JAMAIS par "Voici le résumé..." ou "Analyse du compte..."
- N'utilise JAMAIS de sections avec titres (pas de "Forces:", "Faiblesses:")
- N'utilise JAMAIS de listes à puces ou tirets dans le resume
- Commence DIRECTEMENT par le prénom/username et l'accroche
- Les 2 paragraphes doivent être séparés par EXACTEMENT \\n\\n

---

**INSTRUCTIONS POUR LES AUTRES CHAMPS :**

**points_forts :** Basé sur les vraies données, valorise ce qui fonctionne (engagement, formats, collaborations)
**points_faibles :** Constructifs et basés sur les données (variance, optimisation possible)
**recommandations :** Actionnables et spécifiques (horaires, formats, hashtags, storytelling)

RETOURNE UNIQUEMENT LE JSON, rien d'autre.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Tu es un expert en analyse de comptes TikTok. Tu fournis toujours des réponses au format JSON valide avec un résumé en 2 paragraphes séparés par \\n\\n.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);
    
    return analysis;

  } catch (error) {
    console.error('Erreur analyse IA:', error);
    
    // Retourner une analyse par défaut en cas d'erreur
    return {
      niche: 'Contenu Général',
      resume: `Compte TikTok avec ${userInfo.followerCount?.toLocaleString()} abonnés. Le compte nécessite une analyse plus approfondie pour déterminer sa stratégie de contenu.`,
      points_forts: [
        'Présence établie sur TikTok',
        'Base d\'abonnés existante',
        'Contenu régulier',
        'Engagement de la communauté'
      ],
      points_faibles: [
        'Stratégie de contenu à affiner',
        'Optimisation de la bio recommandée',
        'Cohérence visuelle à améliorer',
        'Fréquence de publication à analyser'
      ],
      recommandations: [
        'Définir une ligne éditoriale claire',
        'Optimiser les descriptions avec des CTA',
        'Analyser les meilleurs horaires de publication',
        'Créer du contenu basé sur les tendances actuelles'
      ]
    };
  }
}

// ⭐ FONCTION calculateStats COMPLÈTE (NOUVELLE FORMULE)
function calculateStats(userInfo, videos) {
  if (!videos || videos.length === 0) {
    return {
      avgViews: 0,
      avgLikes: 0,
      avgComments: 0,
      avgShares: 0,
      engagementRate: 0,
      viralityScore: 0,
      viralityLabel: 'Aucune donnée disponible',
      growthPotential: 'Inconnu',
      growthLabel: 'Données insuffisantes',
      growthColor: 'gray',
      topVideo: null,
      top3Videos: []
    };
  }

  // ✅ CALCULS DE BASE
  const totalViews = videos.reduce((sum, v) => sum + (v.play_count || 0), 0);
  const totalLikes = videos.reduce((sum, v) => sum + (v.digg_count || 0), 0);
  const totalComments = videos.reduce((sum, v) => sum + (v.comment_count || 0), 0);
  const totalShares = videos.reduce((sum, v) => sum + (v.share_count || 0), 0);

  const avgViews = Math.round(totalViews / videos.length);
  const avgLikes = Math.round(totalLikes / videos.length);
  const avgComments = Math.round(totalComments / videos.length);
  const avgShares = Math.round(totalShares / videos.length);

  const totalEngagement = totalLikes + totalComments + totalShares;
  
  // ✅ TAUX D'ENGAGEMENT (basé sur les vues, pas les followers)
  const engagementRate = totalViews > 0 
    ? ((totalEngagement / totalViews) * 100).toFixed(1)
    : 0;

  // Top 3 vidéos
  const sortedVideos = [...videos].sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  const top3Videos = sortedVideos.slice(0, 3).map(v => ({
    title: v.title,
    views: v.play_count,
    likes: v.digg_count,
    url: `https://www.tiktok.com/@${userInfo.uniqueId}/video/${v.video_id}`
  }));

  // ⭐ NOUVELLE FORMULE - SCORE DE VIRALITÉ (sur 10)
  // 60% Vues + 30% Engagement + 10% Consistance
  
  // 1. SCORE VUES (6 points max) - Basé sur ratio vues/followers
  const ratio = userInfo.followerCount > 0 ? avgViews / userInfo.followerCount : 0;
  let viewsScore = 0;
  
  if (ratio >= 50) viewsScore = 6;
  else if (ratio >= 30) viewsScore = 5.5;
  else if (ratio >= 10) viewsScore = 5;
  else if (ratio >= 5) viewsScore = 4;
  else if (ratio >= 2) viewsScore = 3;
  else if (ratio >= 1) viewsScore = 2;
  else if (ratio >= 0.5) viewsScore = 1;
  else viewsScore = 0.5;

  // 2. SCORE ENGAGEMENT (3 points max)
  const engRate = parseFloat(engagementRate);
  let engagementScore = 0;
  
  if (engRate >= 8) engagementScore = 3;
  else if (engRate >= 6) engagementScore = 2.5;
  else if (engRate >= 4) engagementScore = 2;
  else if (engRate >= 3) engagementScore = 1.5;
  else if (engRate >= 2) engagementScore = 1;
  else if (engRate >= 1) engagementScore = 0.7;
  else engagementScore = 0.5;

  // 3. SCORE CONSISTANCE (1 point max)
  const top3Average = top3Videos.length > 0 
    ? top3Videos.reduce((sum, v) => sum + v.views, 0) / top3Videos.length 
    : avgViews;
  const consistency = top3Average > 0 ? avgViews / top3Average : 0;
  let consistencyScore = 0;
  
  if (consistency >= 0.6) consistencyScore = 1;
  else if (consistency >= 0.4) consistencyScore = 0.8;
  else if (consistency >= 0.25) consistencyScore = 0.6;
  else if (consistency >= 0.15) consistencyScore = 0.4;
  else consistencyScore = 0.2;

  // SCORE TOTAL
  const viralityScore = (viewsScore + engagementScore + consistencyScore).toFixed(1);

  // ⭐ LABEL DU SCORE DE VIRALITÉ (NOUVEAU BARÈME)
  let viralityLabel = '';
  const vScore = parseFloat(viralityScore);
  
  if (vScore >= 8) viralityLabel = 'Excellent potentiel viral';
  else if (vScore >= 6) viralityLabel = 'Bon potentiel viral';
  else if (vScore >= 4) viralityLabel = 'Potentiel viral moyen';
  else viralityLabel = 'Potentiel viral limité';

  // ⭐ POTENTIEL DE CROISSANCE (basé sur vues + engagement)
  let growthPotential = 'Moyen';
  let growthLabel = 'Potentiel stable';
  let growthColor = 'yellow';

  if (ratio >= 30 && engRate >= 4) {
    growthPotential = 'Excellent';
    growthLabel = 'Excellent potentiel de croissance';
    growthColor = 'emerald';
  } else if (ratio >= 10 && engRate >= 2) {
    growthPotential = 'Très bon';
    growthLabel = 'Très bon potentiel de croissance';
    growthColor = 'green';
  } else if (ratio >= 5 || engRate >= 2) {
    growthPotential = 'Bon';
    growthLabel = 'Bon potentiel de développement';
    growthColor = 'lime';
  } else if (ratio < 1 && engRate < 1) {
    growthPotential = 'Faible';
    growthLabel = 'Nécessite des améliorations';
    growthColor = 'orange';
  }

  // ✅ RETOURNER TOUTES LES STATS
  return {
    // Stats de base
    avgViews,
    avgLikes,
    avgComments,
    avgShares,
    engagementRate: parseFloat(engagementRate),
    topVideo: top3Videos[0] || null,
    top3Videos,
    
    // ⭐ NOUVELLES STATS
    viralityScore: parseFloat(viralityScore),
    viralityLabel,
    growthPotential,
    growthLabel,
    growthColor
  };
}

// ============================================
// ROUTE : GET /api/user-videos
// Récupérer les 10 dernières vidéos d'un utilisateur connecté
// ============================================
app.get('/api/user-videos', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log('📹 Récupération des vidéos pour l\'utilisateur:', user.id);

    // Récupérer le compte TikTok connecté
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('tiktok_username, avatar_url')
      .eq('user_id', user.id)
      .eq('is_connected', true)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Aucun compte TikTok connecté' });
    }

    console.log('🎬 Compte TikTok:', account.tiktok_username);

    // ⏱️ DÉLAI pour éviter le rate limit de l'API TikWM (1 req/sec max)
    console.log('⏱️ Attente de 1.5 seconde pour éviter le rate limit...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Récupérer les vidéos via TikWM (avec fallback RapidAPI)
    const videos = await fetchTikTokUserVideos(account.tiktok_username, 10);

    console.log(`✅ ${videos.length} vidéos récupérées`);

    return res.status(200).json({
      success: true,
      username: account.tiktok_username,
      avatarUrl: account.avatar_url,
      videos: videos.map(v => ({
        id: v.video_id,
        title: v.title || 'Sans titre',
        thumbnail: v.cover,
        duration: v.duration,
        views: v.play_count || 0,
        likes: v.digg_count || 0,
        comments: v.comment_count || 0,
        shares: v.share_count || 0,
        createTime: v.create_time,
        url: `https://www.tiktok.com/@${account.tiktok_username}/video/${v.video_id}`
      }))
    });

  } catch (error) {
    console.error('❌ Erreur récupération vidéos:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTE : POST /api/analyze-video
// Analyser une vidéo avec l'IA
// ============================================
app.post('/api/analyze-video', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const { videoUrl } = req.body;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log('🎬 Analyse vidéo demandée:', videoUrl);

    // Extraire l'ID de la vidéo depuis l'URL TikTok
    const videoIdMatch = videoUrl.match(/video\/(\d+)/);
    if (!videoIdMatch) {
      return res.status(400).json({ error: 'URL TikTok invalide' });
    }

    const videoId = videoIdMatch[1];

    // Récupérer les infos de la vidéo via TikWM
    const videoInfoUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`;
    const response = await axios.get(videoInfoUrl);

    if (!response.data || !response.data.data) {
      return res.status(404).json({ error: 'Vidéo introuvable' });
    }

    const videoData = response.data.data;

    // Analyser avec l'IA
    const analysis = await analyzeVideoWithAI(videoData);

    console.log('✅ Analyse terminée');

    return res.status(200).json({
      success: true,
      video: {
        id: videoData.id,
        title: videoData.title,
        thumbnail: videoData.cover || videoData.origin_cover,
        duration: videoData.duration,
        views: videoData.play_count,
        likes: videoData.digg_count,
        comments: videoData.comment_count,
        shares: videoData.share_count
      },
      analysis
    });

  } catch (error) {
    console.error('❌ Erreur analyse vidéo:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Fonction pour analyser une vidéo avec l'IA
async function analyzeVideoWithAI(videoData) {
  try {
    // Calculer des métriques de performance
    const views = videoData.play_count || 0;
    const likes = videoData.digg_count || 0;
    const comments = videoData.comment_count || 0;
    const shares = videoData.share_count || 0;
    
    const engagementRate = views > 0 ? (((likes + comments + shares) / views) * 100).toFixed(2) : 0;
    const likeRate = views > 0 ? ((likes / views) * 100).toFixed(2) : 0;
    
    const prompt = `Tu es un expert en analyse de vidéos TikTok. Analyse cette vidéo et fournis un rapport détaillé.

**Informations de la vidéo:**
- Titre: "${videoData.title || 'Sans titre'}"
- Vues: ${views.toLocaleString()}
- Likes: ${likes.toLocaleString()}
- Commentaires: ${comments.toLocaleString()}
- Partages: ${shares.toLocaleString()}
- Durée: ${videoData.duration || 0} secondes
- Taux d'engagement: ${engagementRate}%
- Ratio likes/vues: ${likeRate}%

**Critères d'évaluation du score (sur 10):**
- 0-2: Très faible performance (< 100 vues, engagement < 1%)
- 2-4: Faible performance (100-1K vues, engagement 1-3%)
- 4-6: Performance moyenne (1K-10K vues, engagement 3-5%)
- 6-7.5: Bonne performance (10K-50K vues, engagement 5-8%)
- 7.5-9: Très bonne performance (50K-200K vues, engagement 8-12%)
- 9-10: Excellente performance (>200K vues, engagement >12%)

**IMPORTANT:** Le score doit refléter la VRAIE performance. Une vidéo avec ${views.toLocaleString()} vues et ${engagementRate}% d'engagement ne peut PAS avoir 8.5/10 sauf si elle dépasse vraiment 50K vues avec un bon engagement.

**Format de réponse attendu (JSON strict):**
{
  "summary": "Un paragraphe résumant la performance et le contenu de la vidéo (2-3 phrases maximum).",
  "strengths": [
    "Point fort 1 - Description détaillée et spécifique aux métriques",
    "Point fort 2 - Description détaillée et spécifique aux métriques",
    "Point fort 3 - Description détaillée et spécifique aux métriques"
  ],
  "improvements": [
    "Point d'amélioration 1 - Suggestion concrète basée sur les métriques",
    "Point d'amélioration 2 - Suggestion concrète basée sur les métriques",
    "Point d'amélioration 3 - Suggestion concrète basée sur les métriques"
  ],
  "recommendations": [
    "Recommandation 1 - Action concrète et mesurable",
    "Recommandation 2 - Action concrète et mesurable",
    "Recommandation 3 - Action concrète et mesurable"
  ],
  "score": 6.5
}

**Instructions:**
1. Base ton analyse UNIQUEMENT sur les métriques réelles
2. Le score doit être RÉALISTE et correspondre aux critères ci-dessus
3. Sois honnête : une vidéo avec peu de vues = score bas
4. Sois spécifique et actionnable
5. RETOURNE UNIQUEMENT LE JSON`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Tu es un expert en analyse de vidéos TikTok. Tu fournis toujours des scores RÉALISTES basés sur les vraies performances. Tu ne donnes jamais de scores élevés par défaut. Tu fournis toujours des réponses au format JSON valide.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);
    return analysis;

  } catch (error) {
    console.error('Erreur analyse IA vidéo:', error);
    
    // Retour par défaut AVEC SCORE RÉALISTE
    const views = videoData.play_count || 0;
    let defaultScore = 5.0;
    
    if (views < 100) defaultScore = 2.0;
    else if (views < 1000) defaultScore = 3.5;
    else if (views < 10000) defaultScore = 5.0;
    else if (views < 50000) defaultScore = 6.5;
    else if (views < 200000) defaultScore = 7.5;
    else defaultScore = 8.5;
    
    return {
      summary: "Analyse basée sur les métriques de performance de la vidéo.",
      strengths: [
        "Contenu publié sur TikTok",
        "Format adapté à la plateforme",
        "Vidéo accessible au public"
      ],
      improvements: [
        "Optimiser le titre pour plus de clics",
        "Améliorer le hook des 3 premières secondes",
        "Augmenter la fréquence de publication"
      ],
      recommendations: [
        "Analyser les heures de publication optimales",
        "Créer du contenu similaire aux vidéos performantes",
        "Interagir davantage avec les commentaires"
      ],
      score: defaultScore
    };
  }
}

// ============================================
// ROUTE : POST /api/tiktok-account-stats (POUR ONBOARDING)
// ============================================
app.post('/api/tiktok-account-stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const { username } = req.body;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log(`📊 Analyse du compte TikTok: @${username} pour onboarding`);

    if (!username) {
      return res.status(400).json({ error: 'Username TikTok requis' });
    }

    const cleanUsername = username.replace('@', '');

    // ⏱️ DÉLAI pour éviter le rate limit
    console.log('⏱️ Attente de 1.5 seconde pour éviter le rate limit...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 1. Récupérer les infos du compte (avec fallback RapidAPI)
    const userInfo = await fetchTikTokUserInfo(cleanUsername);

    if (!userInfo) {
      return res.status(404).json({ error: 'Compte TikTok introuvable' });
    }

    console.log(`✅ Compte trouvé: ${userInfo.followerCount} followers`);

    // 2. Récupérer les 10 dernières vidéos (avec fallback RapidAPI)
    const videos = await fetchTikTokUserVideos(cleanUsername, 10);

    if (videos.length === 0) {
      return res.status(404).json({ error: 'Aucune vidéo trouvée' });
    }

    console.log(`📹 ${videos.length} vidéos récupérées`);

    // 3. Calculer les statistiques
    const totalViews = videos.reduce((sum, v) => sum + (v.play_count || 0), 0);
    const totalLikes = videos.reduce((sum, v) => sum + (v.digg_count || 0), 0);
    const totalComments = videos.reduce((sum, v) => sum + (v.comment_count || 0), 0);
    const totalShares = videos.reduce((sum, v) => sum + (v.share_count || 0), 0);
    
    const avgViews = Math.round(totalViews / videos.length);
    const totalEngagement = totalLikes + totalComments + totalShares;
    const engagementRate = totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(1) : 0;
    const followers = userInfo.followerCount || 0;

    // 4. Détecter la niche avec OpenAI
    const videoDescriptions = videos.map(v => v.title || '').filter(t => t).join(' ');
    
    let niche = 'Contenu Général';
    try {
      const nicheCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert en analyse de contenu TikTok. Tu dois identifier la niche principale du compte en 2-4 mots maximum en français.'
          },
          {
            role: 'user',
            content: `Analyse ces descriptions de vidéos TikTok et identifie la niche principale en 2-4 mots (ex: "Fitness & Lifestyle", "Gaming & Tech", "Cuisine & Recettes") : ${videoDescriptions.substring(0, 500)}`
          }
        ],
        max_tokens: 20,
        temperature: 0.3
      });
      niche = nicheCompletion.choices[0]?.message?.content?.trim() || 'Contenu Général';
    } catch (error) {
      console.error('Erreur détection niche:', error);
    }

    // 5. Générer le résumé du compte avec OpenAI
    let summary = `Compte spécialisé dans ${niche} avec une audience de ${followers} abonnés. Les vidéos génèrent en moyenne ${avgViews} vues avec un taux d'engagement de ${engagementRate}%.`;
    try {
      const summaryCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert en analyse de contenu TikTok. Génère un résumé détaillé du compte en 3-4 phrases en français.'
          },
          {
            role: 'user',
            content: `Compte TikTok @${cleanUsername}. Niche: ${niche}. Stats: ${followers} abonnés, ${avgViews} vues moyennes, ${engagementRate}% engagement. Descriptions des vidéos: ${videoDescriptions.substring(0, 500)}`
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      });
      summary = summaryCompletion.choices[0]?.message?.content?.trim() || summary;
    } catch (error) {
      console.error('Erreur génération résumé:', error);
    }

    // 6. Générer les recommandations avec OpenAI
    let recommendations = [
      'Publiez régulièrement pour maintenir l\'engagement de votre audience',
      'Utilisez des hashtags pertinents pour augmenter votre visibilité',
      'Interagissez avec vos abonnés dans les commentaires',
      'Analysez vos meilleures vidéos pour reproduire le succès',
      'Testez différents formats de contenu pour diversifier votre audience'
    ];

    try {
      const recsCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert en croissance TikTok. Génère 5 recommandations concrètes et actionnables en français pour améliorer les performances du compte. Chaque recommandation doit être une phrase complète et spécifique. Retourne uniquement les 5 recommandations, une par ligne, sans numérotation.'
          },
          {
            role: 'user',
            content: `Compte TikTok. Niche: ${niche}. Stats: ${followers} abonnés, ${avgViews} vues moyennes, ${engagementRate}% engagement. Génère 5 recommandations pour améliorer la croissance.`
          }
        ],
        max_tokens: 400,
        temperature: 0.7
      });

      const recsText = recsCompletion.choices[0]?.message?.content?.trim();
      if (recsText) {
        const parsedRecs = recsText.split('\n').filter(r => r.trim().length > 10).map(r => r.replace(/^\d+\.\s*/, '').trim());
        if (parsedRecs.length >= 5) {
          recommendations = parsedRecs.slice(0, 5);
        }
      }
    } catch (error) {
      console.error('Erreur génération recommandations:', error);
    }

    // 7. Calculer le score de viralité (sur 10)
    let viralityScore = 5.0;
    const engRate = parseFloat(engagementRate);
    
    if (engRate >= 8) viralityScore = 9.0;
    else if (engRate >= 6) viralityScore = 7.5;
    else if (engRate >= 4) viralityScore = 6.5;
    else if (engRate >= 2) viralityScore = 5.5;

    // Ajuster selon les vues moyennes
    if (avgViews > 100000) viralityScore += 0.5;
    else if (avgViews > 50000) viralityScore += 0.3;
    else if (avgViews < 1000) viralityScore -= 0.5;

    viralityScore = Math.min(10, Math.max(1, viralityScore)).toFixed(1);

    // 8. Déterminer le potentiel de croissance
    let growthPotential = 'Moyen';
    let growthLabel = 'Potentiel stable';

    if (engRate >= 6 && avgViews > 10000) {
      growthPotential = 'Élevé';
      growthLabel = 'Excellent potentiel de croissance';
    } else if (engRate >= 4 || avgViews > 5000) {
      growthPotential = 'Bon';
      growthLabel = 'Bon potentiel de développement';
    } else if (engRate < 2 && avgViews < 1000) {
      growthPotential = 'Faible';
      growthLabel = 'Nécessite des améliorations';
    }

    // 9. Label du score de viralité
    let viralityLabel = 'Bon potentiel';
    const vScore = parseFloat(viralityScore);
    if (vScore >= 8.5) viralityLabel = 'Excellent potentiel de croissance';
    else if (vScore >= 7) viralityLabel = 'Très bon potentiel';
    else if (vScore >= 5.5) viralityLabel = 'Potentiel moyen';
    else viralityLabel = 'Potentiel à développer';

    // 10. Formater les top 3 vidéos
    const topVideos = videos
      .sort((a, b) => (b.play_count || 0) - (a.play_count || 0))
      .slice(0, 3)
      .map(v => ({
        title: v.title || 'Sans titre',
        views: v.play_count || 0,
        likes: v.digg_count || 0
      }));

   // 11. Générer les Points Forts avec OpenAI
let strengths = [
  'Contenu authentique et inspirant qui crée une connexion émotionnelle',
  'Cohérence visuelle excellente avec une identité de marque forte',
  `Taux d'engagement de ${engagementRate}% ${engRate >= 4 ? 'au-dessus' : 'proche'} de la moyenne`,
  'Publication régulière qui fidélise l\'audience'
];

try {
  const strengthsCompletion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Tu es un expert en analyse de comptes TikTok. Génère 4 points forts spécifiques et détaillés en français basés sur les vraies données du compte. Chaque point doit être une phrase complète. Retourne uniquement les 4 points forts, un par ligne, sans numérotation.'
      },
      {
        role: 'user',
        content: `Compte TikTok @${cleanUsername}. Niche: ${niche}. Stats: ${followers} abonnés, ${avgViews} vues moyennes, ${engagementRate}% engagement, ${userInfo.videoCount} vidéos. Descriptions des vidéos: ${videoDescriptions.substring(0, 500)}. Génère 4 points forts précis et valorisants basés sur ces données réelles.`
      }
    ],
    max_tokens: 300,
    temperature: 0.7
  });

  const strengthsText = strengthsCompletion.choices[0]?.message?.content?.trim();
  if (strengthsText) {
    const parsedStrengths = strengthsText.split('\n').filter(s => s.trim().length > 10).map(s => s.replace(/^\d+\.\s*/, '').trim());
    if (parsedStrengths.length >= 4) {
      strengths = parsedStrengths.slice(0, 4);
    }
  }
} catch (error) {
  console.error('Erreur génération points forts:', error);
}

// 12. Construire la réponse avec TOUTES les stats
const analysisData = {
  username: cleanUsername,
  viralityScore: parseFloat(viralityScore),
  viralityLabel,
  growthPotential,
  growthLabel,
  stats: {
    engagementRate: parseFloat(engagementRate),
    followers,
    avgViews,
    totalLikes: userInfo.heartCount || 0,
    videoCount: userInfo.videoCount || 0,
    following: userInfo.followingCount || 0
  },
  niche,
  summary,
  topVideos,
  recommendations,
  strengths
};

    console.log('✅ Analyse onboarding terminée');

    res.json(analysisData);

  } catch (error) {
    console.error('❌ Erreur analyse TikTok onboarding:', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'analyse du compte',
      details: error.message 
    });
  }
});

// ============================================
// ROUTE DE TEST TIKTOK
// ============================================
app.get('/api/test-tiktok/:username', async (req, res) => {
  try {
    console.log('🧪 TEST: Récupération de', req.params.username);
    
    // Appeler directement la fonction fetchTikTokUserInfo
    const userInfo = await fetchTikTokUserInfo(req.params.username);
    
    if (userInfo) {
      console.log('✅ TEST: Succès!');
      res.json({ success: true, data: userInfo });
    } else {
      console.log('❌ TEST: Pas de données');
      res.status(404).json({ error: 'Compte introuvable' });
    }
  } catch (error) {
    console.error('❌ TEST: Erreur', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Route de test
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'CreateShorts API is running',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/analyze-tracked-account', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username requis' });
    }

    const cleanUsername = username.replace('@', '');

    console.log(`📊 Analyse du compte tracké: @${cleanUsername}`);

    // 1. Récupérer les infos du compte (avec fallback RapidAPI)
    const userInfo = await fetchTikTokUserInfo(cleanUsername);

    if (!userInfo) {
      return res.status(404).json({ error: 'Compte TikTok introuvable' });
    }

    console.log(`✅ Compte trouvé: ${userInfo.followerCount} followers`);

    // 2. Récupérer les vidéos (avec fallback RapidAPI)
    const videos = await fetchTikTokUserVideos(cleanUsername, 10);

    console.log(`📹 ${videos.length} vidéos récupérées`);

    // 3. Calculer les stats avec la même fonction que connect-tiktok
    const stats = calculateStats(userInfo, videos);

    console.log('📊 Stats calculées:', {
      viralityScore: stats.viralityScore,
      viralityLabel: stats.viralityLabel,
      growthPotential: stats.growthPotential,
      growthLabel: stats.growthLabel,
      growthColor: stats.growthColor
    });

    // 4. Retourner les données
    return res.status(200).json({
      success: true,
      account: {
        username: userInfo.uniqueId || cleanUsername,
        nickname: userInfo.nickname,
        avatarUrl: userInfo.avatarLarger || userInfo.avatarMedium,
        followers: userInfo.followerCount,
        following: userInfo.followingCount,
        totalLikes: userInfo.heartCount,
        videoCount: userInfo.videoCount,
        
        // Stats calculées
        viralityScore: stats.viralityScore,
        viralityLabel: stats.viralityLabel,
        growthPotential: stats.growthPotential,
        growthLabel: stats.growthLabel,
        growthColor: stats.growthColor,
        engagementRate: stats.engagementRate,
        avgViews: stats.avgViews,
        avgLikes: stats.avgLikes
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse compte tracké:', error);
    return res.status(500).json({ error: error.message });
  }
});


// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`✅ Backend CreateShorts démarré sur le port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
});

export default app;