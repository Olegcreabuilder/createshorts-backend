// 🔧 Pour React/Vite, tu dois créer un backend séparé (Express ou Netlify Functions)
// Voici l'adaptation pour Express.js

// ============================================
// Option 1 : Backend Express.js
// ============================================
// Fichier : backend/server.js

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';

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

    // 4. Calculer les statistiques
    const stats = calculateStats(userInfo, userVideos);


console.log('💾 Données à sauvegarder:', {
  username,
  avatar_url: userInfo.avatarLarger || userInfo.avatarMedium,
  followers_count: userInfo.followerCount,
  following_count: userInfo.followingCount,
  total_likes: userInfo.heartCount,
  video_count: userInfo.videoCount,
});

    // 5. Sauvegarder dans Supabase
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
        niche: aiAnalysis.niche,
        account_summary: aiAnalysis.resume,
        strengths: aiAnalysis.points_forts,
        weaknesses: aiAnalysis.points_faibles,
        recommendations: aiAnalysis.recommandations,
        stats: stats,
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
        niche: aiAnalysis.niche,
        analysis: aiAnalysis,
        stats,
      },
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({ 
      error: error.message || 'Erreur lors de la connexion du compte' 
    });
  }
});

// Fonction pour récupérer les infos du compte via API TikWM (gratuite et fiable)
async function fetchTikTokUserInfo(username) {
  try {
    console.log('🔧 Tentative avec API TikWM (gratuite)...');
    console.log('📝 Username:', username);
    
    // API TikWM gratuite
    const url = `https://www.tikwm.com/api/user/info?unique_id=${username}`;
    
    console.log('📡 Envoi requête à TikWM...');
    const response = await axios.get(url);
    
    console.log('✅ Réponse reçue, status:', response.status);
    console.log('📦 Data:', JSON.stringify(response.data).substring(0, 300));
    
    if (response.data && response.data.data && response.data.data.user) {
      const userData = response.data.data;
      console.log('✅ Utilisateur trouvé:', userData.user.nickname);
      console.log('🖼️ Avatar brut:', userData.user.avatar);
console.log('🔍 User keys:', Object.keys(userData.user));
      console.log('📊 Structure complète des stats:', JSON.stringify(userData.stats, null, 2));
  console.log('🔍 Keys des stats:', Object.keys(userData.stats || {}));
      
      // Adapter le format TikWM au format attendu
      return {
  id: userData.user.id,
  uniqueId: userData.user.unique_id || username,
  nickname: userData.user.nickname,
  avatarLarger: userData.user.avatarLarger,  // ✅ Déjà correct
  avatarMedium: userData.user.avatarMedium,  // ✅ Déjà correct
  signature: userData.user.signature,
  followerCount: userData.stats?.followerCount || userData.stats?.follower_count || 0,
  followingCount: userData.stats?.followingCount || userData.stats?.following_count || 0,
  heartCount: userData.stats?.heartCount || userData.stats?.heart_count || 0,  // ✅ CORRIGÉ
  videoCount: userData.stats?.videoCount || userData.stats?.video_count || 0,  // ✅ CORRIGÉ
  verified: userData.user.verified || false
      };
    }
    
    console.log('❌ Pas de données utilisateur dans la réponse');
    return null;
  } catch (error) {
    console.error('❌ Erreur TikWM:', error.message);
    if (error.response) {
      console.error('📋 Status:', error.response.status);
      console.error('📋 Data:', error.response.data);
    }
    throw new Error('Impossible de récupérer les infos du compte');
  }
}

// Fonction pour récupérer les vidéos d'un utilisateur via TikWM
async function fetchTikTokUserVideos(username, maxVideos = 10) {
  try {
    const url = `https://www.tikwm.com/api/user/posts?unique_id=${username}&count=${maxVideos}`;
    
    console.log('📡 URL appelée:', url);
    console.log('🔍 Username:', username);
    console.log('🔢 Max vidéos demandées:', maxVideos);
    
    const response = await axios.get(url);
    
    console.log('📥 Statut réponse:', response.status);
    console.log('📦 Structure réponse:', JSON.stringify(response.data).substring(0, 500));
    
    if (response.data && response.data.data && response.data.data.videos) {
      console.log('✅ Vidéos trouvées:', response.data.data.videos.length);
      console.log('🎬 Structure première vidéo:', JSON.stringify(response.data.data.videos[0], null, 2));
      return response.data.data.videos;
    }
    
    console.log('⚠️ Pas de vidéos dans response.data.data.videos');
    console.log('📋 Keys disponibles dans data:', Object.keys(response.data.data || {}));
    
    return [];
  } catch (error) {
    console.error('❌ Erreur TikWM user videos:', error.message);
    if (error.response) {
      console.error('📋 Status:', error.response.status);
      console.error('📋 Data:', JSON.stringify(error.response.data).substring(0, 300));
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

    const prompt = `Tu es un expert en analyse de comptes TikTok. Analyse ce compte et fournis une analyse détaillée.

**Informations du compte:**
- Username: @${userInfo.uniqueId}
- Nom: ${userInfo.nickname}
- Bio: "${userInfo.signature || 'Aucune bio'}"
- Followers: ${userInfo.followerCount?.toLocaleString()}
- Following: ${userInfo.followingCount?.toLocaleString()}
- Total likes: ${userInfo.heartCount?.toLocaleString()}
- Nombre de vidéos: ${userInfo.videoCount}

**Dernières vidéos (${videosData.length}):**
${videosData.map((v, i) => `${i + 1}. "${v.titre}" - ${v.vues.toLocaleString()} vues, ${v.likes.toLocaleString()} likes`).join('\n')}

**Format de réponse attendu (JSON strict):**
{
  "niche": "Titre court de la niche (ex: Fitness & Lifestyle, Éducation Santé, etc.)",
  "resume": "Un paragraphe de 2-3 phrases résumant le compte, son contenu principal, son audience et sa moyenne d'engagement (40K vues).",
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

**Instructions importantes:**
1. Sois spécifique et basé sur les données réelles
2. Les points forts doivent valoriser ce qui fonctionne bien
3. Les points faibles doivent être constructifs
4. Les recommandations doivent être actionnables
5. Utilise un ton professionnel mais encourageant
6. RETOURNE UNIQUEMENT LE JSON, rien d'autre`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Tu es un expert en analyse de comptes TikTok. Tu fournis toujours des réponses au format JSON valide.'
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

// Fonction pour calculer les statistiques
function calculateStats(userInfo, videos) {
  if (!videos || videos.length === 0) {
    return {
      avgViews: 0,
      avgLikes: 0,
      avgComments: 0,
      avgShares: 0,
      engagementRate: 0,
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
  const engagementRate = userInfo.followerCount > 0 
    ? ((totalEngagement / videos.length) / userInfo.followerCount * 100).toFixed(2)
    : 0;

  // Trier les vidéos par nombre de vues (décroissant)
  const sortedVideos = [...videos].sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  const top3Videos = sortedVideos.slice(0, 3).map(v => ({
    title: v.title,
    views: v.play_count,
    likes: v.digg_count,
    url: `https://www.tiktok.com/@${userInfo.uniqueId}/video/${v.video_id}`
  }));

  return {
    avgViews,
    avgLikes,
    avgComments,
    avgShares,
    engagementRate: parseFloat(engagementRate),
    topVideo: top3Videos[0] || null,
    top3Videos: top3Videos
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

    // Récupérer les vidéos via TikWM
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
    const prompt = `Tu es un expert en analyse de vidéos TikTok. Analyse cette vidéo et fournis un rapport détaillé.

**Informations de la vidéo:**
- Titre: "${videoData.title || 'Sans titre'}"
- Vues: ${videoData.play_count?.toLocaleString() || 0}
- Likes: ${videoData.digg_count?.toLocaleString() || 0}
- Commentaires: ${videoData.comment_count?.toLocaleString() || 0}
- Partages: ${videoData.share_count?.toLocaleString() || 0}
- Durée: ${videoData.duration || 0} secondes

**Format de réponse attendu (JSON strict):**
{
  "summary": "Un paragraphe résumant la performance et le contenu de la vidéo.",
  "strengths": [
    "Point fort 1 - Description détaillée",
    "Point fort 2 - Description détaillée",
    "Point fort 3 - Description détaillée"
  ],
  "improvements": [
    "Point d'amélioration 1 - Suggestion concrète",
    "Point d'amélioration 2 - Suggestion concrète",
    "Point d'amélioration 3 - Suggestion concrète"
  ],
  "recommendations": [
    "Recommandation 1 - Action concrète",
    "Recommandation 2 - Action concrète",
    "Recommandation 3 - Action concrète"
  ],
  "score": 8.5
}

**Instructions:**
1. Base ton analyse sur les métriques de performance
2. Sois spécifique et actionnable
3. Fournis un score entre 0 et 10
4. RETOURNE UNIQUEMENT LE JSON`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Tu es un expert en analyse de vidéos TikTok. Tu fournis toujours des réponses au format JSON valide.'
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
    
    // Retour par défaut
    return {
      summary: "Analyse basée sur les métriques de performance de la vidéo.",
      strengths: [
        "Bon taux d'engagement",
        "Format adapté à TikTok",
        "Métriques positives"
      ],
      improvements: [
        "Optimiser le titre",
        "Améliorer le hook",
        "Augmenter l'engagement"
      ],
      recommendations: [
        "Créer du contenu similaire",
        "Analyser les commentaires",
        "Tester différents horaires"
      ],
      score: 7.0
    };
  }
}


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

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`✅ Backend CreateShorts démarré sur le port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
});

export default app;