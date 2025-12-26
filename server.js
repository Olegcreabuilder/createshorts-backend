import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';
import { Resend } from 'resend';
import cron from 'node-cron';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { pipeline } from 'stream';

const streamPipeline = promisify(pipeline);

// Configurer ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Créer le dossier temp
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// WHOP WEBHOOK - DOIT ÊTRE AVANT express.json()
// ============================================
app.post('/api/webhooks/whop', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const payload = req.body.toString();
    const event = JSON.parse(payload);
    
    // Récupérer le type d'événement depuis le header ou détecter par les données
    const eventType = req.headers['x-whop-event-type'] || 
                      req.headers['whop-event-type'] ||
                      detectEventType(event.data);
    
    console.log('📩 [WHOP] Webhook reçu:', eventType);
    console.log('📦 [WHOP] Data:', JSON.stringify(event).substring(0, 500));

    // Initialiser Supabase
    const supabaseWebhook = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const data = event.data;

    // Détecter le type d'événement par le contenu
    if (data?.id?.startsWith('mem_') && data?.status === 'active') {
      // ✅ MEMBERSHIP ACTIVÉ
      console.log('✅ [WHOP] Membership activé détecté');
      
      const userId = data.user?.id;
      const username = data.user?.username;
      const membershipId = data.id;
      const planId = data.plan?.id;
      
      console.log(`👤 [WHOP] User: ${username} (${userId}), Membership: ${membershipId}`);

// Récupérer l'email via l'API Whop ou via pending
let email = null;

// Méthode 1 : Essayer via l'API Whop
if (process.env.WHOP_API_KEY) {
  try {
    const whopResponse = await axios.get(`https://api.whop.com/api/v5/memberships/${membershipId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.WHOP_API_KEY}`
      }
    });
    email = whopResponse.data?.email || whopResponse.data?.user?.email;
    if (email) console.log(`📧 [WHOP] Email via API: ${email}`);
  } catch (apiError) {
    console.log('⚠️ [WHOP] API membership non disponible, utilisation du pending...');
  }
}

// Méthode 2 : Chercher dans les données du webhook
if (!email) {
  email = data.email || data.user?.email || data.checkout_session?.email;
  if (email) console.log(`📧 [WHOP] Email via webhook data: ${email}`);
}

// Méthode 3 : Chercher un paiement pending récent (< 10 min)
if (!email) {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  
  const { data: pendingProfiles } = await supabaseWebhook
    .from('profiles')
    .select('id, email, whop_pending_email, whop_pending_at')
    .not('whop_pending_at', 'is', null)
    .gte('whop_pending_at', tenMinutesAgo)
    .order('whop_pending_at', { ascending: false })
    .limit(5);

  if (pendingProfiles && pendingProfiles.length > 0) {
    // Prendre le plus récent
    const pendingProfile = pendingProfiles[0];
    email = pendingProfile.whop_pending_email || pendingProfile.email;
    console.log(`📧 [WHOP] Email via pending: ${email}`);
  }
}

if (!email) {
  console.error('❌ [WHOP] Impossible de trouver l\'email');
  return res.status(200).json({ received: true, error: 'Email not found' });
}

      // Trouver l'utilisateur par email
      const { data: profile, error: findError } = await supabaseWebhook
        .from('profiles')
        .select('id, email')
        .ilike('email', email)
        .single();

      if (findError || !profile) {
        console.error('❌ [WHOP] Utilisateur non trouvé:', email);
        return res.status(200).json({ received: true, error: 'User not found' });
      }

      // Déterminer le type d'abonnement
      let billingType = 'monthly';
      if (planId === 'plan_5kjPsMjNEMiSO') {
        billingType = 'annual';
      }

      // Mettre à jour le profil → PRO
      const { error: updateError } = await supabaseWebhook
        .from('profiles')
        .update({
          role: 'pro',
          plan: 'Pro',  
          subscription_status: 'active',
          billing_type: billingType,
          whop_membership_id: membershipId,
          whop_user_id: userId,
          subscription_start: new Date().toISOString(),
          credits_video_analysis: 150,    // ✅ Remplacé
          credits_idea_generation: 150    // ✅ Remplacé
        })
        .eq('id', profile.id);

      if (updateError) {
        console.error('❌ [WHOP] Erreur update:', updateError);
      } else {
        console.log(`✅ [WHOP] Utilisateur ${email} upgradé en PRO (${billingType})`);
      }
    }
    
    else if (data?.id?.startsWith('mem_') && (data?.status === 'cancelled' || data?.status === 'inactive')) {
      // ❌ MEMBERSHIP ANNULÉ
      console.log('⚠️ [WHOP] Membership annulé/inactif détecté');
      
      const membershipId = data.id;
      
      // Trouver l'utilisateur par membership_id
      const { data: profile } = await supabaseWebhook
        .from('profiles')
        .select('id, email')
        .eq('whop_membership_id', membershipId)
        .single();

      if (profile) {
        await supabaseWebhook
          .from('profiles')
          .update({
            role: 'free',
            subscription_status: 'cancelled',
            credits_video: 3,
            credits_ideas: 3
          })
          .eq('id', profile.id);

        console.log(`✅ [WHOP] Utilisateur ${profile.email} repassé en FREE`);
      }
    }
    
    else if (data?.id?.startsWith('pay_') && data?.status === 'paid') {
      // 💳 PAIEMENT RÉUSSI
      console.log(`💳 [WHOP] Paiement réussi: ${data.id}`);
    }
    
    else {
      console.log(`ℹ️ [WHOP] Event non géré:`, eventType, data?.id);
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ [WHOP] Erreur webhook:', error);
    res.status(200).json({ received: true, error: error.message });
  }
});

// Fonction helper pour détecter le type d'événement
function detectEventType(data) {
  if (!data?.id) return 'unknown';
  
  if (data.id.startsWith('mem_')) {
    if (data.status === 'active') return 'membership.activated';
    if (data.status === 'cancelled') return 'membership.cancelled';
    if (data.status === 'inactive') return 'membership.inactive';
    return 'membership.updated';
  }
  
  if (data.id.startsWith('pay_')) {
    if (data.status === 'paid') return 'payment.succeeded';
    if (data.status === 'failed') return 'payment.failed';
    return 'payment.updated';
  }
  
  return 'unknown';
}

console.log('✅ Whop webhooks configurés');

// ============================================
// MIDDLEWARE STANDARD (après le webhook Whop)
// ============================================
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Initialisation Supabase avec SERVICE_ROLE_KEY
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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
// ============================================
cron.schedule('*/15 * * * *', async () => {
  console.log('⏰ [CRON] Vérification des emails à envoyer...');

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const buffer = new Date(Date.now() - 75 * 60 * 1000);

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
      const result = await sendPromoEmail(user.email, user.first_name);

      if (result.success) {
        await supabase
          .from('profiles')
          .update({ promo_email_sent: new Date().toISOString() })
          .eq('id', user.id);

        console.log(`✅ [CRON] Email envoyé à ${user.email}`);
      } else {
        console.error(`❌ [CRON] Échec pour ${user.email}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('✅ [CRON] Terminé');

  } catch (error) {
    console.error('❌ [CRON] Exception:', error);
  }
});

console.log('✅ Cron job emails automatiques activé (toutes les 15 minutes)');

// ============================================
// ROUTES EMAIL
// ============================================
app.post('/api/send-bulk-promo-emails', async (req, res) => {
  try {
    const { adminKey } = req.body;

    if (adminKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    console.log('🚀 [BULK] Démarrage envoi emails en masse...');

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

app.post('/api/test-promo-email', async (req, res) => {
  try {
    const { email, firstName, adminKey } = req.body;

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

// ============================================
// ROUTE WHOP : Vérifier le statut d'un membre
// ============================================
app.get('/api/whop/check-membership/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, subscription_status, whop_membership_id, billing_type')
      .eq('email', email)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      isPro: profile.role === 'pro',
      status: profile.subscription_status,
      billingType: profile.billing_type,
      membershipId: profile.whop_membership_id
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    const { username, userToken } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username requis' });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(userToken);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log(`🔍 Récupération du compte TikTok: @${username}`);

    const userInfo = await fetchTikTokUserInfo(username);

    if (!userInfo) {
      return res.status(404).json({ error: 'Compte TikTok introuvable' });
    }

    console.log(`✅ Compte trouvé: ${userInfo.followerCount} followers`);

    const userVideos = await fetchTikTokUserVideos(username);

    console.log(`📹 ${userVideos.length} vidéos récupérées`);

    const aiAnalysis = await analyzeAccountWithAI(userInfo, userVideos);

    console.log('🤖 Analyse IA terminée');

    const stats = calculateStats(userInfo, userVideos);

    const { 
      viralityScore, 
      viralityLabel, 
      growthPotential, 
      growthLabel,
      growthColor,
      engagementRate,
      avgViews,
      avgLikes,
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
      avgLikes
    });

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
        virality_score: viralityScore,
        virality_label: viralityLabel,
        growth_potential: growthPotential,
        growth_label: growthLabel,
        growth_color: growthColor,
        engagement_rate: engagementRate,
        avg_views: avgViews,
        avg_likes: avgLikes,
        niche: aiAnalysis.niche,
        account_summary: aiAnalysis.resume,
        strengths: aiAnalysis.points_forts,
        weaknesses: aiAnalysis.points_faibles,
        recommendations: aiAnalysis.recommandations,
        stats: otherStats,
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
        viralityScore,
        viralityLabel,
        growthPotential,
        growthLabel,
        growthColor,
        engagementRate,
        avgViews,
        avgLikes,
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
// FONCTIONS TIKTOK AVEC MULTI-FALLBACK ROBUSTE
// ============================================

// Fonction utilitaire pour attendre
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fonction utilitaire pour retry
async function withRetry(fn, retries = 2, delayMs = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries) throw error;
      console.log(`⏳ Retry ${i + 1}/${retries} après erreur: ${error.message}`);
      await delay(delayMs);
    }
  }
}

// Headers pour simuler un vrai navigateur
const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://www.tikwm.com/',
  'Origin': 'https://www.tikwm.com'
};

// ============================================
// FONCTIONS USER INFO
// ============================================

// API 1: TikWM Principal
async function fetchFromTikWM(username) {
  console.log('🔧 [API 1] TikWM Principal...');
  
  const response = await axios.get(
    `https://www.tikwm.com/api/user/info?unique_id=${username}`,
    { 
      timeout: 20000,
      headers: browserHeaders
    }
  );
  
  if (response.data?.data?.user) {
    const userData = response.data.data;
    console.log('✅ [API 1] TikWM - Utilisateur trouvé:', userData.user.nickname);
    
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
  
  throw new Error('Pas de données TikWM');
}

// API 2: TikWM Endpoint alternatif (POST)
async function fetchFromTikWM2(username) {
  console.log('🔧 [API 2] TikWM Alternatif POST...');
  
  const response = await axios.post(
    'https://www.tikwm.com/api/user/info',
    `unique_id=${username}`,
    { 
      timeout: 20000,
      headers: {
        ...browserHeaders,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  
  if (response.data?.data?.user) {
    const userData = response.data.data;
    console.log('✅ [API 2] TikWM POST - Utilisateur trouvé:', userData.user.nickname);
    
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
  
  throw new Error('Pas de données TikWM POST');
}

// API 3: RapidAPI (dernier recours)
async function fetchFromRapidAPI(username) {
  console.log('🔧 [API 3] RapidAPI...');
  
  if (!process.env.RAPIDAPI_KEY) {
    throw new Error('RAPIDAPI_KEY non configurée');
  }
  
  const response = await axios.get(
    'https://tiktok-scraper7.p.rapidapi.com/user/info',
    {
      params: { unique_id: username },
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
      },
      timeout: 15000
    }
  );
  
  if (response.data?.data?.user) {
    const userData = response.data.data;
    console.log('✅ [API 3] RapidAPI - Utilisateur trouvé:', userData.user.nickname);
    
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
  
  throw new Error('Pas de données RapidAPI');
}

// FONCTION PRINCIPALE USER INFO avec fallback multi-API
async function fetchTikTokUserInfo(username) {
  console.log('🔍 Récupération du compte TikTok:', username);
  
  const apis = [
    { name: 'TikWM Principal', fn: () => fetchFromTikWM(username) },
    { name: 'TikWM POST', fn: () => fetchFromTikWM2(username) },
    { name: 'RapidAPI', fn: () => fetchFromRapidAPI(username) }
  ];
  
  for (const api of apis) {
    try {
      const result = await withRetry(api.fn, 1, 2000);
      if (result) {
        console.log(`✅ Succès avec ${api.name}`);
        return result;
      }
    } catch (error) {
      console.error(`❌ ${api.name} échoué:`, error.message);
    }
  }
  
  throw new Error('Impossible de récupérer les infos du compte. Toutes les APIs ont échoué. Veuillez réessayer dans quelques minutes.');
}

// ============================================
// FONCTIONS VIDEOS
// ============================================

// API 1: TikWM Videos via endpoint feed
async function fetchVideosFromTikWM(username, maxVideos) {
  console.log('🔧 [API 1] TikWM Videos Feed...');
  
  // Utiliser l'endpoint feed au lieu de posts
  const response = await axios.get(
    `https://www.tikwm.com/api/user/posts?unique_id=${username}&count=${maxVideos}&cursor=0`,
    { 
      timeout: 25000,
      headers: {
        ...browserHeaders,
        'Cookie': 'tt_webid=1234567890123456789',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    }
  );
  
  if (response.data?.data?.videos?.length > 0) {
    console.log('✅ [API 1] TikWM Feed - Vidéos trouvées:', response.data.data.videos.length);
    return response.data.data.videos;
  }
  
  throw new Error('Pas de vidéos TikWM Feed');
}

// API 2: TikWM via URL directe (méthode alternative)
async function fetchVideosFromTikWM2(username, maxVideos) {
  console.log('🔧 [API 2] TikWM URL Method...');
  
  // D'abord récupérer l'ID de l'utilisateur
  const userResponse = await axios.get(
    `https://www.tikwm.com/api/user/info?unique_id=${username}`,
    { 
      timeout: 15000,
      headers: browserHeaders
    }
  );
  
  const secUid = userResponse.data?.data?.user?.secUid;
  
  if (!secUid) {
    throw new Error('SecUid non trouvé');
  }
  
  // Utiliser le secUid pour récupérer les vidéos
  const videosResponse = await axios.post(
    'https://www.tikwm.com/api/user/posts',
    `unique_id=${username}&count=${maxVideos}&cursor=0&secUid=${secUid}`,
    { 
      timeout: 25000,
      headers: {
        ...browserHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'tt_webid=1234567890123456789'
      }
    }
  );
  
  if (videosResponse.data?.data?.videos?.length > 0) {
    console.log('✅ [API 2] TikWM SecUid - Vidéos trouvées:', videosResponse.data.data.videos.length);
    return videosResponse.data.data.videos;
  }
  
  throw new Error('Pas de vidéos TikWM SecUid');
}

// API 3: Scrape direct TikTok (via proxy tikwm)
async function fetchVideosFromTikWMProxy(username, maxVideos) {
  console.log('🔧 [API 3] TikWM Proxy...');
  
  const tiktokUrl = `https://www.tiktok.com/@${username}`;
  
  const response = await axios.get(
    `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&count=${maxVideos}`,
    { 
      timeout: 25000,
      headers: browserHeaders
    }
  );
  
  // Cette API retourne les infos différemment
  if (response.data?.data) {
    const data = response.data.data;
    
    // Si c'est une vidéo unique, on peut au moins avoir ça
    if (data.id) {
      console.log('✅ [API 3] TikWM Proxy - 1 vidéo trouvée');
      return [{
        video_id: data.id,
        title: data.title || '',
        cover: data.cover || data.origin_cover,
        duration: data.duration,
        play_count: data.play_count || 0,
        digg_count: data.digg_count || 0,
        comment_count: data.comment_count || 0,
        share_count: data.share_count || 0,
        create_time: data.create_time
      }];
    }
  }
  
  throw new Error('Pas de vidéos TikWM Proxy');
}

// API 4: RapidAPI Videos
async function fetchVideosFromRapidAPI(username, maxVideos) {
  console.log('🔧 [API 4] RapidAPI Videos...');
  
  if (!process.env.RAPIDAPI_KEY) {
    throw new Error('RAPIDAPI_KEY non configurée');
  }
  
  const response = await axios.get(
    'https://tiktok-scraper7.p.rapidapi.com/user/posts',
    {
      params: { unique_id: username, count: maxVideos.toString() },
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
      },
      timeout: 15000
    }
  );
  
  if (response.data?.data?.videos?.length > 0) {
    const videos = response.data.data.videos;
    console.log('✅ [API 4] RapidAPI - Vidéos trouvées:', videos.length);
    
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
  
  throw new Error('Pas de vidéos RapidAPI');
}

// API 5: TikAPI.io pour les vidéos
async function fetchVideosFromTikAPI(username, maxVideos) {
  console.log('🔧 [API 5] TikAPI Videos...');
  
  const response = await axios.get(
    `https://api16-normal-c-useast1a.tiktokv.com/aweme/v1/feed/?user_id=${username}&count=${maxVideos}`,
    { 
      timeout: 15000,
      headers: {
        'User-Agent': 'TikTok 26.2.0 rv:262018 (iPhone; iOS 14.4.2; en_US) Cronet'
      }
    }
  );
  
  if (response.data?.aweme_list?.length > 0) {
    console.log('✅ [API 5] TikAPI - Vidéos trouvées:', response.data.aweme_list.length);
    return response.data.aweme_list.map(v => ({
      video_id: v.aweme_id,
      title: v.desc || '',
      cover: v.video?.cover?.url_list?.[0] || '',
      duration: v.video?.duration || 0,
      play_count: v.statistics?.play_count || 0,
      digg_count: v.statistics?.digg_count || 0,
      comment_count: v.statistics?.comment_count || 0,
      share_count: v.statistics?.share_count || 0,
      create_time: v.create_time
    }));
  }
  
  throw new Error('Pas de vidéos TikAPI');
}

// FONCTION PRINCIPALE VIDEOS avec fallback
async function fetchTikTokUserVideos(username, maxVideos = 10) {
  console.log('📹 Récupération des vidéos pour:', username);
  
  const apis = [
    { name: 'TikWM Videos Feed', fn: () => fetchVideosFromTikWM(username, maxVideos) },
    { name: 'TikWM SecUid', fn: () => fetchVideosFromTikWM2(username, maxVideos) },
    { name: 'TikWM Proxy', fn: () => fetchVideosFromTikWMProxy(username, maxVideos) },
    { name: 'RapidAPI Videos', fn: () => fetchVideosFromRapidAPI(username, maxVideos) },
    { name: 'TikAPI Videos', fn: () => fetchVideosFromTikAPI(username, maxVideos) }
  ];
  
  for (const api of apis) {
    try {
      const result = await withRetry(api.fn, 1, 2000);
      if (result && result.length > 0) {
        console.log(`✅ Vidéos récupérées avec ${api.name}: ${result.length} vidéos`);
        return result;
      }
    } catch (error) {
      console.error(`❌ ${api.name} échoué:`, error.message);
    }
  }
  
  console.log('⚠️ Aucune vidéo récupérée, retour tableau vide');
  return [];
}

// ============================================
// FONCTION ANALYSE COMPTE IA
// ============================================
async function analyzeAccountWithAI(userInfo, videos) {
  try {
    const videosData = videos.slice(0, 10).map(v => ({
      titre: v.title || '',
      vues: v.play_count || 0,
      likes: v.digg_count || 0,
      commentaires: v.comment_count || 0,
      partages: v.share_count || 0,
    }));

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
    const flopVideos = [...videosData].sort((a, b) => a.vues - b.vues).slice(0, 2);
    const topViews = topVideos[0]?.vues || avgViews;
    const flopViews = flopVideos[0]?.vues || avgViews;
    
    const consistencyRatio = flopViews > 0 ? (topViews / flopViews).toFixed(1) : 'N/A';

    const prompt = `Tu es un coach TikTok expert. Analyse ce compte de manière UNIQUE et PERSONNALISÉE.

**COMPTE : @${userInfo.uniqueId}**
- Nom : ${userInfo.nickname}
- Bio : "${userInfo.signature || 'Aucune bio'}"
- Followers : ${userInfo.followerCount?.toLocaleString()}
- Total Likes : ${userInfo.heartCount?.toLocaleString()}
- Vidéos publiées : ${userInfo.videoCount}
- Following : ${userInfo.followingCount?.toLocaleString()}

**MÉTRIQUES CALCULÉES :**
- Engagement Rate : ${engagementRate}%
- Vues moyennes : ${avgViews.toLocaleString()}
- Likes moyens : ${avgLikes.toLocaleString()}
- Ratio Top/Flop : ${consistencyRatio}x (écart entre meilleure et moins bonne vidéo)

**LES ${videosData.length} DERNIÈRES VIDÉOS :**
${videosData.map((v, i) => `${i+1}. "${v.titre.substring(0,50)}..." → ${v.vues.toLocaleString()} vues, ${v.likes.toLocaleString()} likes`).join('\n')}

**TOP 3 :**
${topVideos.map((v, i) => `${i+1}. "${v.titre.substring(0,40)}..." : ${v.vues.toLocaleString()} vues`).join('\n')}

**FLOP 2 :**
${flopVideos.map((v, i) => `${i+1}. "${v.titre.substring(0,40)}..." : ${v.vues.toLocaleString()} vues`).join('\n')}

---

**TA MISSION : Produire une analyse SPÉCIFIQUE à ce compte.**

Analyse les VRAIS patterns visibles dans les données :
- Quels sujets/formats performent le mieux ? (regarde les titres des tops)
- Quels sujets/formats sous-performent ? (regarde les titres des flops)
- Y a-t-il une cohérence thématique ou c'est dispersé ?
- L'écart top/flop (${consistencyRatio}x) révèle quoi sur la consistance ?

---

**⛔ EXPRESSIONS INTERDITES (ne les utilise JAMAIS) :**
- "connexion émotionnelle"
- "authenticité brute"  
- "engagement de la communauté"
- "cohérence visuelle"
- "identité de marque forte"
- "contenu authentique et inspirant"
- "fidélise l'audience"
- "stratégie de contenu"
- "ligne éditoriale"
- "optimisation de la bio"

**✅ À LA PLACE, sois CONCRET et SPÉCIFIQUE :**
- Mentionne des TITRES réels du compte
- Compare les tops vs les flops avec des exemples
- Donne des chiffres précis du compte
- Adapte le vocabulaire à la NICHE de ce créateur

---

**FORMAT JSON STRICT :**

{
  "niche": "IMPORTANT : Format 'Mot1 & Mot2' avec MAJUSCULES sur chaque mot. Exemples : 'Lifestyle & Beauté', 'Gaming & Tech', 'Analyse Films & Séries', 'Fitness & Motivation', 'Cuisine & Recettes'. Utilise & et non /.",
  
  "resume": "OBLIGATOIRE : 2 PARAGRAPHES DISTINCTS séparés par \\n\\n
  
  **PARAGRAPHE 1 - LES FORCES (120-150 mots) :**
  Commence DIRECTEMENT par le prénom/pseudo suivi d'une accroche percutante sur ses stats.
  Analyse ce qui FONCTIONNE en citant des exemples concrets de vidéos qui marchent.
  Mentionne les chiffres réels (vues, engagement).
  Identifie le format/angle qui performe le mieux.
  Ton admiratif et valorisant.
  
  **PARAGRAPHE 2 - LES AXES D'AMÉLIORATION (100-130 mots) :**
  Commence OBLIGATOIREMENT par 'Cependant' ou 'Toutefois'.
  Analyse l'écart entre les tops et les flops (ratio ${consistencyRatio}x).
  Identifie pourquoi certaines vidéos sous-performent en citant des exemples.
  Donne des pistes concrètes basées sur les patterns observés.
  Termine sur une note motivante avec un objectif.
  Ton coach constructif.",
  
  "points_forts": [
    "Point fort 1 - SPÉCIFIQUE avec exemple ou chiffre du compte (ex: 'Tes vidéos GRWM performent 3x mieux que la moyenne avec X vues')",
    "Point fort 2 - SPÉCIFIQUE basé sur les données réelles",
    "Point fort 3 - SPÉCIFIQUE lié à un pattern identifié dans les tops",
    "Point fort 4 - SPÉCIFIQUE avec référence à une vidéo ou un format"
  ],
  
  "points_faibles": [
    "Point faible 1 - CONCRET basé sur les flops analysés (ex: 'Les vidéos sans hook clair comme [titre] plafonnent à Xk vues')",
    "Point faible 2 - CONCRET avec exemple de ce qui ne marche pas",
    "Point faible 3 - CONCRET lié à un pattern identifié",
    "Point faible 4 - CONCRET avec piste d'amélioration"
  ],
  
  "recommandations": [
    "Recommandation 1 - ACTION PRÉCISE basée sur ce qui marche (ex: 'Reproduis le format de [top vidéo] qui a fait Xk vues')",
    "Recommandation 2 - ACTION PRÉCISE pour corriger un point faible identifié",
    "Recommandation 3 - ACTION PRÉCISE avec exemple de contenu à créer",
    "Recommandation 4 - ACTION PRÉCISE liée à la niche du créateur"
  ]
}

---

**RÈGLES ABSOLUES :**
1. Le résumé DOIT contenir EXACTEMENT 2 paragraphes séparés par \\n\\n
2. Le paragraphe 2 DOIT commencer par "Cependant" ou "Toutefois"
3. La niche DOIT être formatée avec Majuscules & Majuscules (pas de minuscules, pas de /)
4. Chaque point fort/faible DOIT mentionner un élément concret du compte
5. JAMAIS de phrases génériques applicables à n'importe quel compte

RETOURNE UNIQUEMENT LE JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Tu es un coach TikTok expert qui produit des analyses UNIQUES et PERSONNALISÉES.

RÈGLES STRICTES :
- Le résumé contient TOUJOURS 2 paragraphes : Forces puis Axes d'amélioration
- Le 2ème paragraphe commence TOUJOURS par "Cependant" ou "Toutefois"
- La niche est TOUJOURS formatée "Mot & Mot" avec majuscules (ex: "Gaming & Tech")
- Tu mentionnes des éléments concrets : titres de vidéos, chiffres, formats
- Tu N'UTILISES JAMAIS d'expressions génériques

Tu fournis des réponses JSON valides.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.85,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);
    
    // POST-TRAITEMENT : Formater la niche correctement
    if (analysis.niche) {
      analysis.niche = analysis.niche.replace(/\//g, ' & ');
      analysis.niche = analysis.niche
        .split(' ')
        .map(word => {
          if (word === '&') return '&';
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    }
    
    // Vérifier que le résumé contient bien 2 paragraphes
    if (analysis.resume && !analysis.resume.includes('\n\n')) {
      const cependantIndex = analysis.resume.toLowerCase().indexOf('cependant');
      const toutefoisIndex = analysis.resume.toLowerCase().indexOf('toutefois');
      const splitIndex = cependantIndex > 0 ? cependantIndex : toutefoisIndex;
      
      if (splitIndex > 0) {
        analysis.resume = analysis.resume.substring(0, splitIndex).trim() + '\n\n' + analysis.resume.substring(splitIndex).trim();
      }
    }
    
    return analysis;

  } catch (error) {
    console.error('Erreur analyse IA:', error);
    
    return {
      niche: 'Contenu Général',
      resume: `@${userInfo.uniqueId}, avec ${userInfo.followerCount?.toLocaleString()} abonnés et ${userInfo.heartCount?.toLocaleString()} likes au total, tu as construit une base solide sur TikTok. Tes vidéos génèrent en moyenne des performances qui méritent d'être analysées pour identifier tes formats gagnants et capitaliser dessus.\n\nCependant, l'écart entre tes meilleures et moins bonnes vidéos suggère des opportunités d'optimisation. En identifiant précisément ce qui différencie tes tops de tes flops - que ce soit le hook, le format ou le sujet - tu pourrais stabiliser tes performances et viser une croissance plus régulière sur chaque publication.`,
      points_forts: [
        `Base d'audience de ${userInfo.followerCount?.toLocaleString()} abonnés à activer`,
        `${userInfo.videoCount} vidéos publiées - données suffisantes pour identifier les patterns gagnants`,
        'Présence établie sur la plateforme avec historique de contenu analysable',
        'Potentiel d\'optimisation identifiable via l\'analyse des tops vs flops'
      ],
      points_faibles: [
        'Écart de performance entre vidéos à analyser pour comprendre les facteurs de succès',
        'Formats gagnants à identifier et systématiser pour plus de régularité',
        'Hooks et accroches à tester pour améliorer le taux de rétention',
        'Consistance des performances à travailler pour stabiliser les vues'
      ],
      recommandations: [
        'Analyse tes 3 meilleures vidéos : quel format, quel hook, quel sujet ? Reproduis ces éléments',
        'Compare avec tes flops : qu\'est-ce qui manque ? Accroche ? Tension ? Sujet porteur ?',
        'Teste un format "défi" ou "countdown" sur ton prochain contenu pour créer de l\'urgence',
        'Publie aux heures où tes tops ont été postés pour maximiser la portée initiale'
      ]
    };
  }
}

// ============================================
// FONCTION calculateStats
// ============================================
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

  const totalViews = videos.reduce((sum, v) => sum + (v.play_count || 0), 0);
  const totalLikes = videos.reduce((sum, v) => sum + (v.digg_count || 0), 0);
  const totalComments = videos.reduce((sum, v) => sum + (v.comment_count || 0), 0);
  const totalShares = videos.reduce((sum, v) => sum + (v.share_count || 0), 0);

  const avgViews = Math.round(totalViews / videos.length);
  const avgLikes = Math.round(totalLikes / videos.length);
  const avgComments = Math.round(totalComments / videos.length);
  const avgShares = Math.round(totalShares / videos.length);

  const totalEngagement = totalLikes + totalComments + totalShares;
  
  const engagementRate = totalViews > 0 
    ? ((totalEngagement / totalViews) * 100).toFixed(1)
    : 0;

  const sortedVideos = [...videos].sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  const top3Videos = sortedVideos.slice(0, 3).map(v => ({
    title: v.title,
    views: v.play_count,
    likes: v.digg_count,
    url: `https://www.tiktok.com/@${userInfo.uniqueId}/video/${v.video_id}`
  }));

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

  const engRate = parseFloat(engagementRate);
  let engagementScore = 0;
  
  if (engRate >= 8) engagementScore = 3;
  else if (engRate >= 6) engagementScore = 2.5;
  else if (engRate >= 4) engagementScore = 2;
  else if (engRate >= 3) engagementScore = 1.5;
  else if (engRate >= 2) engagementScore = 1;
  else if (engRate >= 1) engagementScore = 0.7;
  else engagementScore = 0.5;

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

  const viralityScore = (viewsScore + engagementScore + consistencyScore).toFixed(1);

  let viralityLabel = '';
  const vScore = parseFloat(viralityScore);
  
  if (vScore >= 8) viralityLabel = 'Excellent potentiel viral';
  else if (vScore >= 6) viralityLabel = 'Bon potentiel viral';
  else if (vScore >= 4) viralityLabel = 'Potentiel viral moyen';
  else viralityLabel = 'Potentiel viral limité';

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

  return {
    avgViews,
    avgLikes,
    avgComments,
    avgShares,
    engagementRate: parseFloat(engagementRate),
    topVideo: top3Videos[0] || null,
    top3Videos,
    viralityScore: parseFloat(viralityScore),
    viralityLabel,
    growthPotential,
    growthLabel,
    growthColor
  };
}

// ============================================
// ROUTE : GET /api/user-videos
// ============================================
// ============================================
// TRANSCRIPTION WHISPER & GÉNÉRATION IDÉES
// À INSÉRER APRÈS calculateStats() ET AVANT app.get('/api/user-videos'...)
// ============================================

// ============================================
// FONCTION : Télécharger une vidéo TikTok
// ============================================
async function downloadTikTokVideo(videoUrl, videoId) {
  try {
    console.log(`📥 Téléchargement vidéo ${videoId}...`);
    
    const tikwmUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`;
    const response = await axios.get(tikwmUrl, { timeout: 15000 });
    
    if (!response.data?.data?.play) {
      throw new Error('URL de téléchargement non trouvée');
    }
    
    const downloadUrl = response.data.data.play;
    const videoPath = path.join(TEMP_DIR, `${videoId}.mp4`);
    
    const videoResponse = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const writer = fs.createWriteStream(videoPath);
    await streamPipeline(videoResponse.data, writer);
    
    console.log(`✅ Vidéo ${videoId} téléchargée`);
    return videoPath;
    
  } catch (error) {
    console.error(`❌ Erreur téléchargement vidéo ${videoId}:`, error.message);
    return null;
  }
}

// ============================================
// FONCTION : Extraire l'audio d'une vidéo
// ============================================
async function extractAudio(videoPath, videoId) {
  return new Promise((resolve, reject) => {
    const audioPath = path.join(TEMP_DIR, `${videoId}.mp3`);
    
    console.log(`🎵 Extraction audio ${videoId}...`);
    
    ffmpeg(videoPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('end', () => {
        console.log(`✅ Audio ${videoId} extrait`);
        resolve(audioPath);
      })
      .on('error', (err) => {
        console.error(`❌ Erreur extraction audio ${videoId}:`, err.message);
        reject(err);
      })
      .save(audioPath);
  });
}

// ============================================
// FONCTION : Transcrire avec Whisper
// ============================================
async function transcribeAudio(audioPath, videoId) {
  try {
    console.log(`🎤 Transcription ${videoId}...`);
    
    const audioFile = fs.createReadStream(audioPath);
    
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'fr',
      response_format: 'text'
    });
    
    console.log(`✅ Transcription ${videoId} terminée (${transcription.length} chars)`);
    return transcription;
    
  } catch (error) {
    console.error(`❌ Erreur transcription ${videoId}:`, error.message);
    return null;
  }
}

// ============================================
// FONCTION : Nettoyer les fichiers temporaires
// ============================================
function cleanupTempFiles(videoId) {
  try {
    const videoPath = path.join(TEMP_DIR, `${videoId}.mp4`);
    const audioPath = path.join(TEMP_DIR, `${videoId}.mp3`);
    
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    
    console.log(`🧹 Fichiers temp ${videoId} nettoyés`);
  } catch (error) {
    console.error(`⚠️ Erreur nettoyage ${videoId}:`, error.message);
  }
}

// ============================================
// FONCTION : Transcrire une vidéo complète
// ============================================
async function transcribeVideo(videoUrl, videoId) {
  let videoPath = null;
  let audioPath = null;
  
  try {
    videoPath = await downloadTikTokVideo(videoUrl, videoId);
    if (!videoPath) return null;
    
    audioPath = await extractAudio(videoPath, videoId);
    if (!audioPath) return null;
    
    const transcription = await transcribeAudio(audioPath, videoId);
    return transcription;
    
  } catch (error) {
    console.error(`❌ Erreur transcription vidéo ${videoId}:`, error.message);
    return null;
    
  } finally {
    cleanupTempFiles(videoId);
  }
}

// ============================================
// FONCTION : Transcrire plusieurs vidéos
// ============================================
async function transcribeMultipleVideos(videos, username, maxVideos = 10) {
  const transcriptions = [];
  const videosToProcess = videos.slice(0, maxVideos);
  
  console.log(`📝 Début transcription de ${videosToProcess.length} vidéos pour @${username}`);
  
  for (const video of videosToProcess) {
    const videoId = video.video_id || video.id;
    const videoUrl = `https://www.tiktok.com/@${username}/video/${videoId}`;
    
    try {
      const transcription = await transcribeVideo(videoUrl, videoId);
      
      if (transcription && transcription.trim().length > 20) {
        transcriptions.push({
          videoId,
          title: video.title || '',
          views: video.play_count || 0,
          likes: video.digg_count || 0,
          transcription: transcription.trim()
        });
      }
      
      // Pause entre chaque vidéo
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`⚠️ Skip vidéo ${videoId}:`, error.message);
    }
  }
  
  console.log(`✅ ${transcriptions.length}/${videosToProcess.length} vidéos transcrites`);
  return transcriptions;
}

// ============================================
// FONCTION : Générer des idées personnalisées avec GPT-4
// ============================================
async function generatePersonalizedIdeas(transcriptions, niche, account) {
  try {
    const transcriptionData = transcriptions.map((t, i) => ({
      index: i + 1,
      title: t.title,
      views: t.views,
      likes: t.likes,
      script: t.transcription.substring(0, 500)
    }));

    const sortedByViews = [...transcriptionData].sort((a, b) => b.views - a.views);
    const topPerformers = sortedByViews.slice(0, 3);
    const lowPerformers = sortedByViews.slice(-2);

    const allScripts = transcriptions.map(t => t.transcription).join('\n\n---\n\n');

    const prompt = `Tu es un expert en création de contenu TikTok. Analyse ces transcriptions de vidéos et génère 3 nouvelles idées de contenu ULTRA personnalisées.

**CRÉATEUR : @${account.tiktok_username}**
- Niche : ${niche}
- Followers : ${account.followers_count?.toLocaleString() || 'N/A'}

**TOP 3 VIDÉOS (meilleures performances) :**
${topPerformers.map(v => `📈 "${v.title}" - ${v.views.toLocaleString()} vues
Script : "${v.script}..."`).join('\n\n')}

**VIDÉOS MOINS PERFORMANTES :**
${lowPerformers.map(v => `📉 "${v.title}" - ${v.views.toLocaleString()} vues
Script : "${v.script}..."`).join('\n\n')}

**TOUS LES SCRIPTS POUR ANALYSER LE STYLE :**
${allScripts.substring(0, 3000)}

---

**TA MISSION :**

1. **ANALYSE LE STYLE DE LANGAGE** du créateur :
   - Vocabulaire utilisé (familier, soutenu, argot, anglicismes...)
   - Façon de s'adresser à l'audience (tu/vous, interpellation directe...)
   - Tics de langage, expressions récurrentes
   - Rythme et structure des phrases
   - Ton général (humoristique, sérieux, provocateur, bienveillant...)

2. **IDENTIFIE CE QUI FONCTIONNE** :
   - Quels sujets performent le mieux ?
   - Quels types de hooks marchent ?
   - Quelle structure de vidéo engage le plus ?

3. **GÉNÈRE 3 IDÉES** basées sur ces analyses

---

**FORMAT JSON STRICT :**

{
  "styleAnalysis": {
    "vocabulary": "Description du vocabulaire utilisé",
    "tone": "Description du ton général",
    "speechPatterns": ["Expression récurrente 1", "Expression récurrente 2", "Expression récurrente 3"],
    "addressStyle": "Comment le créateur s'adresse à son audience"
  },
  "ideas": [
    {
      "id": 1,
      "title": "Titre accrocheur de l'idée (format TikTok)",
      "description": "Description de l'idée en 2-3 phrases",
      "whyItWorks": "Explication de pourquoi cette idée fonctionnera basée sur les analyses",
      "hookSuggestion": "Suggestion de hook basée sur le style du créateur",
      "icon": "🎯",
      "category": "transformation|secret|challenge|storytime|tips|comparison"
    },
    {
      "id": 2,
      "title": "...",
      "description": "...",
      "whyItWorks": "...",
      "hookSuggestion": "...",
      "icon": "💡",
      "category": "..."
    },
    {
      "id": 3,
      "title": "...",
      "description": "...",
      "whyItWorks": "...",
      "hookSuggestion": "...",
      "icon": "🔥",
      "category": "..."
    }
  ]
}

**RÈGLES ABSOLUES :**
- Les idées doivent être DIFFÉRENTES des vidéos existantes mais dans le même style
- Le titre doit être accrocheur et adapté à TikTok
- Le hookSuggestion doit utiliser LE MÊME style de langage que le créateur
- Chaque idée doit capitaliser sur ce qui fonctionne dans les tops

RETOURNE UNIQUEMENT LE JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Tu es un expert en stratégie de contenu TikTok. Tu analyses le style unique de chaque créateur pour proposer des idées parfaitement adaptées à leur façon de communiquer.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.8,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return result;

  } catch (error) {
    console.error('❌ Erreur génération idées IA:', error);
    throw error;
  }
}

// ============================================
// FONCTION : Générer un script personnalisé (800-1500 caractères)
// ============================================
async function generatePersonalizedScript(title, description, category, transcriptions, niche, account) {
  try {
    const existingScripts = transcriptions.map(t => t.transcription).slice(0, 5);
    
    const sortedTranscriptions = [...transcriptions].sort((a, b) => b.views - a.views);
    const topScripts = sortedTranscriptions.slice(0, 3).map(t => ({
      script: t.transcription,
      views: t.views
    }));

    const prompt = `Tu es un expert en copywriting pour TikTok. Génère un script COMPLET et PERSONNALISÉ.

**CRÉATEUR : @${account.tiktok_username}**
- Niche : ${niche}
- Followers : ${account.followers_count?.toLocaleString() || 'N/A'}

**IDÉE À SCRIPTER :**
- Titre : "${title}"
- Description : ${description}
- Catégorie : ${category}

**SCRIPTS LES PLUS PERFORMANTS DU CRÉATEUR (pour copier le style) :**
${topScripts.map((s, i) => `
--- SCRIPT ${i + 1} (${s.views.toLocaleString()} vues) ---
${s.script}
`).join('\n')}

**TOUS LES SCRIPTS POUR LE STYLE :**
${existingScripts.join('\n\n---\n\n').substring(0, 2500)}

---

**TA MISSION :**

Génère un script COMPLET de **800 à 1500 caractères** qui :

1. **COPIE EXACTEMENT LE STYLE** du créateur :
   - Même vocabulaire (argot, expressions, anglicismes si utilisés)
   - Même façon de s'adresser à l'audience
   - Mêmes tics de langage et expressions favorites
   - Même rythme de phrases
   - Même ton (humour, sérieux, provocation, etc.)

2. **STRUCTURE EFFICACE** :
   - **HOOK (0-3 sec)** : Accroche percutante qui stoppe le scroll
   - **TENSION (3-15 sec)** : Créer de la curiosité, un enjeu
   - **CONTENU (15-45 sec)** : La valeur, l'information, l'histoire
   - **CTA (fin)** : Appel à l'action naturel (follow, like, commentaire)

3. **FORMAT DU SCRIPT** :
   - Écrit comme le créateur PARLE (pas comme il écrit)
   - Phrases courtes et percutantes
   - Pauses naturelles indiquées par "..."
   - Émotions et intonations entre [crochets] si pertinent

---

**RÈGLES ABSOLUES :**
- Le script doit faire entre 800 et 1500 caractères
- Il doit sonner EXACTEMENT comme le créateur parle
- Pas de langage générique ou corporate
- Des phrases punchy, pas de blabla
- Adapté au format vertical TikTok

RETOURNE UNIQUEMENT LE SCRIPT (pas de JSON, pas d'explication).`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Tu es un copywriter expert en TikTok. Tu dois écrire des scripts qui sonnent EXACTEMENT comme le créateur parle - pas comme un robot ou un marketeur.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.85,
      max_tokens: 1500
    });

    let script = completion.choices[0].message.content.trim();
    return script;

  } catch (error) {
    console.error('❌ Erreur génération script IA:', error);
    throw error;
  }
}

// ============================================
// ROUTE : POST /api/generate-content-ideas
// ============================================
app.post('/api/generate-content-ideas', async (req, res) => {
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

    console.log('💡 Génération d\'idées de contenu pour:', user.id);

    // Récupérer le compte connecté
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_connected', true)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Aucun compte TikTok connecté' });
    }

    const username = account.tiktok_username;
    const niche = account.niche || 'Contenu Général';
    
    console.log(`📊 Compte: @${username}, Niche: ${niche}`);

    // Récupérer les vidéos
    const videos = await fetchTikTokUserVideos(username, 15);
    
    if (videos.length === 0) {
      return res.status(404).json({ error: 'Aucune vidéo trouvée' });
    }

    console.log(`📹 ${videos.length} vidéos récupérées, début transcription...`);

    // Transcrire les vidéos (peut prendre du temps)
    const transcriptions = await transcribeMultipleVideos(videos, username, 10);

    if (transcriptions.length === 0) {
      return res.status(500).json({ error: 'Impossible de transcrire les vidéos' });
    }

    // Analyser le style et générer des idées
    const ideas = await generatePersonalizedIdeas(transcriptions, niche, account);

    console.log(`✅ ${ideas.ideas?.length || 0} idées générées`);

    // Sauvegarder les transcriptions pour usage ultérieur
    await supabase
      .from('connected_accounts')
      .update({
        last_transcriptions: transcriptions,
        transcriptions_updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);

    return res.status(200).json({
      success: true,
      ideas,
      transcriptionsCount: transcriptions.length,
      niche
    });

  } catch (error) {
    console.error('❌ Erreur génération idées:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTE : POST /api/generate-script
// ============================================
app.post('/api/generate-script', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const { ideaId, ideaTitle, ideaDescription, ideaCategory } = req.body;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log('📝 Génération de script pour:', ideaTitle);

    // Récupérer le compte et les transcriptions
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_connected', true)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Aucun compte TikTok connecté' });
    }

    const transcriptions = account.last_transcriptions || [];
    const niche = account.niche || 'Contenu Général';

    if (transcriptions.length === 0) {
      return res.status(400).json({ error: 'Veuillez d\'abord analyser vos vidéos' });
    }

    // Générer le script personnalisé
    const script = await generatePersonalizedScript(
      ideaTitle,
      ideaDescription,
      ideaCategory,
      transcriptions,
      niche,
      account
    );

    console.log(`✅ Script généré (${script.length} caractères)`);

    return res.status(200).json({
      success: true,
      script,
      characterCount: script.length
    });

  } catch (error) {
    console.error('❌ Erreur génération script:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTE : POST /api/generate-single-idea
// Génère UNE SEULE nouvelle idée à partir des transcriptions en cache
// Coût : 1 crédit (au lieu de 3 pour l'analyse complète)
// ============================================
app.post('/api/generate-single-idea', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const { existingIdeas } = req.body;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log('💡 Génération d\'une nouvelle idée pour:', user.id);

    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_connected', true)
      .single();

    if (accountError || !account) {
      return res.status(404).json({ error: 'Aucun compte TikTok connecté' });
    }

    const transcriptions = account.last_transcriptions;
    const niche = account.niche || 'Contenu Général';

    if (!transcriptions || transcriptions.length === 0) {
      return res.status(400).json({ 
        error: 'Aucune analyse en cache. Veuillez d\'abord analyser vos vidéos.',
        needsFullAnalysis: true
      });
    }

    console.log(`📊 Utilisation de ${transcriptions.length} transcriptions en cache`);

    const newIdea = await generateSingleIdea(transcriptions, niche, account, existingIdeas || []);

    console.log('✅ Nouvelle idée générée');

    return res.status(200).json({
      success: true,
      idea: newIdea,
      fromCache: true
    });

  } catch (error) {
    console.error('❌ Erreur génération idée:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================
// FONCTION : Générer UNE SEULE idée
// ============================================
async function generateSingleIdea(transcriptions, niche, account, existingIdeas) {
  try {
    const transcriptionData = transcriptions.map((t, i) => ({
      index: i + 1,
      title: t.title,
      views: t.views,
      likes: t.likes,
      script: t.transcription.substring(0, 400)
    }));

    const sortedByViews = [...transcriptionData].sort((a, b) => b.views - a.views);
    const topPerformers = sortedByViews.slice(0, 3);
    const allScripts = transcriptions.map(t => t.transcription).join('\n\n---\n\n');

    const existingTitles = existingIdeas.map(idea => idea.title).join('\n- ');

    const prompt = `Tu es un expert en création de contenu TikTok. Génère UNE SEULE nouvelle idée de contenu ULTRA personnalisée.

**CRÉATEUR : @${account.tiktok_username}**
- Niche : ${niche}
- Followers : ${account.followers_count?.toLocaleString() || 'N/A'}

**TOP 3 VIDÉOS (meilleures performances) :**
${topPerformers.map(v => `📈 "${v.title}" - ${v.views.toLocaleString()} vues
Script : "${v.script}..."`).join('\n\n')}

**SCRIPTS POUR ANALYSER LE STYLE :**
${allScripts.substring(0, 2500)}

${existingTitles ? `**⚠️ IDÉES DÉJÀ GÉNÉRÉES (NE PAS RÉPÉTER) :**
- ${existingTitles}` : ''}

---

**TA MISSION :**

Génère UNE SEULE nouvelle idée qui :
1. Est DIFFÉRENTE des idées déjà générées
2. Capitalise sur ce qui fonctionne (tops)
3. Utilise le MÊME style de langage que le créateur
4. Est adaptée à la niche ${niche}

---

**FORMAT JSON STRICT :**

{
  "idea": {
    "id": ${Date.now()},
    "title": "Titre accrocheur de l'idée (format TikTok)",
    "description": "Description de l'idée en 2-3 phrases",
    "whyItWorks": "Explication de pourquoi cette idée fonctionnera",
    "hookSuggestion": "Suggestion de hook basée sur le style du créateur",
    "icon": "🎯",
    "category": "transformation|secret|challenge|storytime|tips|comparison|reaction|tutorial"
  }
}

**RÈGLES :**
- L'idée doit être FRAÎCHE et ORIGINALE
- Le titre doit être accrocheur
- Le hook doit utiliser le style du créateur
- Choisis une icône différente si possible (🎯💡🔥⚡✨🎬📱💪)

RETOURNE UNIQUEMENT LE JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Tu es un expert en stratégie de contenu TikTok. Tu génères des idées uniques et personnalisées basées sur le style du créateur.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.9,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    
    const idea = result.idea;
    const icons = ['🎯', '💡', '🔥', '⚡', '✨', '🎬', '📱', '💪', '🚀', '💎'];
    const bgColors = ['#e8eef7', '#e8f4f8', '#fef3c7', '#fce7f3', '#dbeafe', '#d1fae5', '#fef9c3'];
    
    return {
      ...idea,
      id: Date.now() + Math.random(),
      icon: idea.icon || icons[Math.floor(Math.random() * icons.length)],
      iconBg: bgColors[Math.floor(Math.random() * bgColors.length)],
      iconColor: '#4f7cff'
    };

  } catch (error) {
    console.error('❌ Erreur génération idée unique:', error);
    throw error;
  }
}

// ============================================
// ROUTE : GET /api/get-cached-ideas
// ============================================
app.get('/api/get-cached-ideas', async (req, res) => {
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

    const { data: account } = await supabase
      .from('connected_accounts')
      .select('last_transcriptions, transcriptions_updated_at, niche')
      .eq('user_id', user.id)
      .eq('is_connected', true)
      .single();

    if (!account?.last_transcriptions) {
      return res.json({ cached: false });
    }

    // Vérifier si les transcriptions sont récentes (moins de 24h)
    const updatedAt = new Date(account.transcriptions_updated_at);
    const now = new Date();
    const hoursDiff = (now - updatedAt) / (1000 * 60 * 60);

    if (hoursDiff > 24) {
      return res.json({ cached: false, reason: 'expired' });
    }

    return res.json({
      cached: true,
      transcriptionsCount: account.last_transcriptions.length,
      niche: account.niche,
      updatedAt: account.transcriptions_updated_at
    });

  } catch (error) {
    console.error('❌ Erreur get cached ideas:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================
// FIN DU BLOC À INSÉRER
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

    console.log('⏱️ Attente de 1.5 seconde pour éviter le rate limit...');
    await new Promise(resolve => setTimeout(resolve, 1500));

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

    const videoIdMatch = videoUrl.match(/video\/(\d+)/);
    if (!videoIdMatch) {
      return res.status(400).json({ error: 'URL TikTok invalide' });
    }

    const videoId = videoIdMatch[1];

    const videoInfoUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`;
    const response = await axios.get(videoInfoUrl);

    if (!response.data || !response.data.data) {
      return res.status(404).json({ error: 'Vidéo introuvable' });
    }

    const videoData = response.data.data;

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

// ============================================
// FONCTION ANALYSE VIDEO IA
// ============================================
async function analyzeVideoWithAI(videoData) {
  try {
    const views = videoData.play_count || 0;
    const likes = videoData.digg_count || 0;
    const comments = videoData.comment_count || 0;
    const shares = videoData.share_count || 0;
    
    const engagementRate = views > 0 ? (((likes + comments + shares) / views) * 100).toFixed(2) : 0;
    const likeRate = views > 0 ? ((likes / views) * 100).toFixed(2) : 0;
    
    const prompt = `Tu es un expert TikTok. Analyse cette vidéo SPÉCIFIQUE de manière UNIQUE.

**VIDÉO :**
- Titre : "${videoData.title || 'Sans titre'}"
- Vues : ${views.toLocaleString()}
- Likes : ${likes.toLocaleString()}
- Commentaires : ${comments.toLocaleString()}
- Partages : ${shares.toLocaleString()}
- Durée : ${videoData.duration || 0}s
- Engagement : ${engagementRate}%
- Ratio likes/vues : ${likeRate}%

---

**CRITÈRES DE SCORE (respecte strictement) :**
- 0-2: < 100 vues
- 2-4: 100-1K vues
- 4-6: 1K-10K vues
- 6-7.5: 10K-50K vues
- 7.5-9: 50K-200K vues
- 9-10: >200K vues

---

**INSTRUCTIONS CRUCIALES :**

1. **ANALYSE LE TITRE RÉEL** : "${videoData.title || 'Sans titre'}"
   - Qu'est-ce que ce titre révèle sur le contenu ?
   - Quel angle/hook est utilisé ?
   - Quelle émotion est ciblée ?

2. **SOIS SPÉCIFIQUE À CETTE VIDÉO**
   - Mentionne des éléments CONCRETS du titre
   - Adapte ton analyse au SUJET réel de la vidéo
   - Ne fais pas d'analyse générique

3. **VARIE TON VOCABULAIRE**
   - Utilise des formulations DIFFÉRENTES à chaque analyse
   - Évite les phrases toutes faites

---

**⛔ EXPRESSIONS INTERDITES (ne les utilise JAMAIS) :**
- "situation universelle"
- "authenticité brute"
- "défi temps réel"
- "connexion émotionnelle instantanée"
- "tension narrative addictive"
- "le cerveau du spectateur"
- "mécanique psychologique"
- "identification immédiate"

**✅ À LA PLACE, utilise des formulations FRAÎCHES et SPÉCIFIQUES :**
- Décris ce qui se passe DANS cette vidéo précise
- Utilise le vocabulaire du SUJET de la vidéo
- Sois concret : "le moment où elle montre X", "l'accroche sur Y"

---

**FORMAT JSON :**

{
  "summary": "4-5 phrases. Analyse CETTE vidéo spécifiquement. Mentionne des éléments du titre. Explique pourquoi CE contenu particulier fonctionne ou pas. Pas de phrases génériques.",
  
  "strengths": [
    "Point fort SPÉCIFIQUE à cette vidéo - mentionne un élément concret du contenu",
    "Deuxième point fort UNIQUE - basé sur ce que montre vraiment la vidéo",
    "Troisième point fort PRÉCIS - lié au sujet/angle de cette vidéo"
  ],
  
  "improvements": [
    "Amélioration concrète pour CE type de contenu",
    "Suggestion spécifique basée sur le sujet de la vidéo",
    "Conseil adapté à cette niche/ce format"
  ],
  
  "recommendations": [
    "Action concrète en lien avec le thème de cette vidéo",
    "Idée de contenu similaire à tester",
    "Optimisation spécifique pour ce format"
  ],
  
  "score": X.X
}

---

RETOURNE UNIQUEMENT LE JSON.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Tu es un analyste TikTok. Tu produis des analyses UNIQUES et SPÉCIFIQUES à chaque vidéo.

RÈGLES :
- Chaque analyse doit être DIFFÉRENTE
- Mentionne des éléments CONCRETS du titre/contenu
- N'utilise JAMAIS d'expressions génériques répétitives
- Adapte ton vocabulaire au SUJET de la vidéo
- Sois précis, pas vague

Tu fournis des réponses JSON valides.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.9,
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);
    return analysis;

  } catch (error) {
    console.error('Erreur analyse IA vidéo:', error);
    
    const views = videoData.play_count || 0;
    let defaultScore = 5.0;
    
    if (views < 100) defaultScore = 2.0;
    else if (views < 1000) defaultScore = 3.5;
    else if (views < 10000) defaultScore = 5.0;
    else if (views < 50000) defaultScore = 6.5;
    else if (views < 200000) defaultScore = 7.5;
    else defaultScore = 8.5;
    
    return {
      summary: `Cette vidéo "${(videoData.title || 'Sans titre').substring(0, 50)}..." mérite une analyse approfondie. Les métriques actuelles suggèrent des axes d'optimisation, notamment sur l'accroche initiale et la structure du contenu.`,
      strengths: [
        "Contenu publié et indexé par l'algorithme TikTok",
        "Format vidéo adapté à la consommation mobile",
        "Base de données disponible pour analyser les performances"
      ],
      improvements: [
        "Travailler l'accroche des 2 premières secondes pour capter l'attention immédiatement",
        "Structurer le contenu avec un enjeu clair dès le début",
        "Ajouter des éléments visuels ou textuels pour renforcer le message"
      ],
      recommendations: [
        "Tester différents hooks en début de vidéo",
        "Analyser les vidéos similaires qui performent mieux dans cette niche",
        "Publier à des horaires optimaux pour maximiser la portée initiale"
      ],
      score: defaultScore
    };
  }
}
// ============================================
// ROUTE : POST /api/tiktok-account-stats (ONBOARDING)
// REMPLACE L'ANCIENNE VERSION DANS server.js
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

    console.log('⏱️ Attente de 1.5 seconde pour éviter le rate limit...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    const userInfo = await fetchTikTokUserInfo(cleanUsername);

    if (!userInfo) {
      return res.status(404).json({ error: 'Compte TikTok introuvable' });
    }

    console.log(`✅ Compte trouvé: ${userInfo.followerCount} followers`);

    const videos = await fetchTikTokUserVideos(cleanUsername, 10);

    if (videos.length === 0) {
      return res.status(404).json({ error: 'Aucune vidéo trouvée' });
    }

    console.log(`📹 ${videos.length} vidéos récupérées`);

    const totalViews = videos.reduce((sum, v) => sum + (v.play_count || 0), 0);
    const totalLikes = videos.reduce((sum, v) => sum + (v.digg_count || 0), 0);
    const totalComments = videos.reduce((sum, v) => sum + (v.comment_count || 0), 0);
    const totalShares = videos.reduce((sum, v) => sum + (v.share_count || 0), 0);
    
    const avgViews = Math.round(totalViews / videos.length);
    const avgLikes = Math.round(totalLikes / videos.length);
    const totalEngagement = totalLikes + totalComments + totalShares;
    const engagementRate = totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(1) : 0;
    const followers = userInfo.followerCount || 0;

    const videoDescriptions = videos.map(v => v.title || '').filter(t => t).join(' ');
    
    // Calculer le ratio vues/followers
    const ratio = followers > 0 ? (avgViews / followers).toFixed(2) : 0;
    
    // Trier les vidéos pour avoir les tops
    const topVideos = videos
      .sort((a, b) => (b.play_count || 0) - (a.play_count || 0))
      .slice(0, 3)
      .map(v => ({
        title: v.title || 'Sans titre',
        views: v.play_count || 0,
        likes: v.digg_count || 0
      }));

    let niche = 'Contenu Général';
    try {
      const nicheCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'Tu es un expert en analyse de contenu TikTok. Tu dois identifier la niche principale du compte en 2-4 mots maximum en français. Format: "Mot & Mot" avec majuscules.'
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

    let viralityScore = 5.0;
    const engRate = parseFloat(engagementRate);
    
    if (engRate >= 8) viralityScore = 9.0;
    else if (engRate >= 6) viralityScore = 7.5;
    else if (engRate >= 4) viralityScore = 6.5;
    else if (engRate >= 2) viralityScore = 5.5;

    if (avgViews > 100000) viralityScore += 0.5;
    else if (avgViews > 50000) viralityScore += 0.3;
    else if (avgViews < 1000) viralityScore -= 0.5;

    viralityScore = Math.min(10, Math.max(1, viralityScore)).toFixed(1);

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

    let viralityLabel = 'Bon potentiel';
    const vScore = parseFloat(viralityScore);
    if (vScore >= 8.5) viralityLabel = 'Excellent potentiel de croissance';
    else if (vScore >= 7) viralityLabel = 'Très bon potentiel';
    else if (vScore >= 5.5) viralityLabel = 'Potentiel moyen';
    else viralityLabel = 'Potentiel à développer';

    // ============================================
    // GÉNÉRATION DES POINTS FORTS (AMÉLIORÉ)
    // ============================================
    let strengths = [
      `Base d'audience de ${followers.toLocaleString()} abonnés engagés`,
      `${userInfo.videoCount} vidéos publiées avec un historique analysable`,
      `Taux d'engagement de ${engagementRate}% sur les dernières vidéos`,
      'Présence établie sur la plateforme TikTok'
    ];

    try {
      const topVideo = topVideos[0];

      const strengthsPrompt = `Tu es un coach TikTok expert. Analyse ce compte et génère 4 points forts SPÉCIFIQUES et PERSONNALISÉS.

**COMPTE : @${cleanUsername}**
- Niche : ${niche}
- Followers : ${followers.toLocaleString()}
- Total Likes : ${(userInfo.heartCount || 0).toLocaleString()}
- Vidéos publiées : ${userInfo.videoCount}

**MÉTRIQUES :**
- Engagement Rate : ${engagementRate}%
- Vues moyennes : ${avgViews.toLocaleString()}
- Likes moyens : ${avgLikes.toLocaleString()}
- Ratio vues/followers : ${ratio}x

**TOP VIDÉO :**
"${topVideo?.title || 'N/A'}" → ${(topVideo?.views || 0).toLocaleString()} vues

**DESCRIPTIONS DES VIDÉOS :**
${videoDescriptions.substring(0, 600)}

---

**⛔ EXPRESSIONS INTERDITES (ne les utilise JAMAIS) :**
- "connexion émotionnelle"
- "authenticité brute"
- "cohérence visuelle"
- "identité de marque forte"
- "contenu authentique et inspirant"
- "fidélise l'audience"
- "stratégie de contenu"
- "ligne éditoriale"

**✅ À LA PLACE, sois CONCRET et SPÉCIFIQUE :**
- Mentionne des CHIFFRES réels du compte
- Cite des éléments des TITRES de vidéos si pertinent
- Adapte le vocabulaire à la NICHE "${niche}"
- Chaque point doit être UNIQUE à ce compte

---

**FORMAT : 4 points forts, un par ligne, sans numérotation ni tirets.**

Exemples de BONS points forts :
- "Tes vidéos génèrent ${avgViews.toLocaleString()} vues en moyenne, soit ${ratio}x ton nombre d'abonnés"
- "Ta meilleure vidéo '${(topVideo?.title || '').substring(0, 30)}...' prouve que ton format fonctionne"
- "Ton taux d'engagement de ${engagementRate}% est ${parseFloat(engagementRate) >= 4 ? 'supérieur' : 'proche'} de la moyenne TikTok (3-5%)"

Génère 4 points forts UNIQUES pour @${cleanUsername} :`;

      const strengthsCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Tu es un coach TikTok qui valorise les créateurs avec des analyses SPÉCIFIQUES.

RÈGLES STRICTES :
- Chaque point fort doit mentionner un élément CONCRET (chiffre, titre, métrique)
- JAMAIS de phrases génériques applicables à n'importe quel compte
- Utilise le vocabulaire de la niche du créateur
- Ton positif et motivant mais basé sur des FAITS`
          },
          {
            role: 'user',
            content: strengthsPrompt
          }
        ],
        max_tokens: 400,
        temperature: 0.8
      });

      const strengthsText = strengthsCompletion.choices[0]?.message?.content?.trim();
      if (strengthsText) {
        const parsedStrengths = strengthsText
          .split('\n')
          .filter(s => s.trim().length > 15)
          .map(s => s.replace(/^[-•\d.)\s]+/, '').trim())
          .filter(s => s.length > 0);
        
        if (parsedStrengths.length >= 4) {
          strengths = parsedStrengths.slice(0, 4);
        } else if (parsedStrengths.length >= 2) {
          // Compléter avec des points par défaut basés sur les données
          strengths = [
            ...parsedStrengths,
            `${avgViews.toLocaleString()} vues moyennes par vidéo`,
            `Taux d'engagement de ${engagementRate}% sur ton contenu`
          ].slice(0, 4);
        }
      }
    } catch (error) {
      console.error('Erreur génération points forts:', error);
      // Fallback avec des données réelles
      strengths = [
        `Base de ${followers.toLocaleString()} abonnés sur TikTok`,
        `${avgViews.toLocaleString()} vues en moyenne par vidéo`,
        `Taux d'engagement de ${engagementRate}% sur ton contenu`,
        `${userInfo.videoCount} vidéos publiées - contenu régulier`
      ];
    }

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
// ROUTES DE TEST
// ============================================
app.get('/api/test-tiktok/:username', async (req, res) => {
  try {
    console.log('🧪 TEST: Récupération de', req.params.username);
    
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

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'CreateShorts API is running',
    whop: 'configured',
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

    const userInfo = await fetchTikTokUserInfo(cleanUsername);

    if (!userInfo) {
      return res.status(404).json({ error: 'Compte TikTok introuvable' });
    }

    console.log(`✅ Compte trouvé: ${userInfo.followerCount} followers`);

    const videos = await fetchTikTokUserVideos(cleanUsername, 10);

    console.log(`📹 ${videos.length} vidéos récupérées`);

    const stats = calculateStats(userInfo, videos);

    console.log('📊 Stats calculées:', {
      viralityScore: stats.viralityScore,
      viralityLabel: stats.viralityLabel,
      growthPotential: stats.growthPotential,
      growthLabel: stats.growthLabel,
      growthColor: stats.growthColor
    });

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

// ============================================
// ROUTE : GET /api/account-videos/:username
// Pour la page Statistiques - récupère les vidéos d'un compte
// ============================================
app.get('/api/account-videos/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const count = parseInt(req.query.count) || 35;
    
    console.log(`📹 [Statistics] Récupération des vidéos pour @${username}`);
    
    const videos = await fetchTikTokUserVideos(username, count);
    
    console.log(`✅ [Statistics] ${videos.length} vidéos récupérées pour @${username}`);
    
    return res.status(200).json({
      success: true,
      videos: videos.map(v => ({
        video_id: v.video_id || v.id,
        title: v.title || v.desc || '',
        cover: v.cover || v.origin_cover,
        play: v.play || v.playUrl || '',
        duration: v.duration || 0,
        play_count: v.play_count || v.playCount || 0,
        digg_count: v.digg_count || v.diggCount || 0,
        comment_count: v.comment_count || v.commentCount || 0,
        share_count: v.share_count || v.shareCount || 0,
        collect_count: v.collect_count || v.collectCount || 0,
        create_time: v.create_time || v.createTime || 0
      }))
    });
    
  } catch (error) {
    console.error('❌ [Statistics] Erreur:', error.message);
    return res.status(500).json({ error: error.message, videos: [] });
  }
});


// ============================================
// DÉMARRER LE SERVEUR
// ============================================
app.listen(PORT, () => {
  console.log(`✅ Backend CreateShorts démarré sur le port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🔗 Whop webhook: /api/webhooks/whop`);
});

export default app;