// ============================================
// MONETIZABLE ACCOUNTS - VRAIES DONNÉES TIKTOK
// ============================================

const ACCOUNTS_TO_TRACK = [
  'alex2cars',
  'tiago_musique78',
  'ohhkevin',
  'mighty_world',
  'crabe.de.sable',
  'les.pires.logements',
  'techtoktor',
  'unknowfootball1',
  'smxsurtiktok',
  'lelascar06',
  'cylindreetpiston',
  'pr.willyy',
  'boringbusiness_fr',
  'zackaidelofff',
  'jordy.spamm.96',
  'incroyabletv_01',
  'noa.kurzawalive',
  'monsieur_meteo_007',
  'memphis_jrrr',
  'lesblaguedemeh',
  'neck_ian',
  'dylan4mma',
  'unknownmma2.0',
  'nobusinessfr',
  'mathetbas',
  'chadi_v2v',
  'ohuncamping',
  'ohunblond',
  'byozer_cuisine',
  'kbenzelarigolade',
  'tdfmanga'
];

// Catégories par username
const CATEGORIES_MAP = {
  'alex2cars': 'Automobile',
  'tiago_musique78': 'Musique',
  'ohhkevin': 'Humour',
  'mighty_world': 'Voyage',
  'crabe.de.sable': 'Humour',
  'les.pires.logements': 'Immobilier',
  'techtoktor': 'Tech',
  'unknowfootball1': 'Gaming',
  'smxsurtiktok': 'Business',
  'lelascar06': 'Automobile',
  'cylindreetpiston': 'Automobile',
  'pr.willyy': 'Fitness',
  'boringbusiness_fr': 'Business',
  'zackaidelofff': 'Humour',
  'jordy.spamm.96': 'Business',
  'incroyabletv_01': 'Divertissement',
  'noa.kurzawalive': 'Voyage',
  'monsieur_meteo_007': 'Tech',
  'memphis_jrrr': 'Humour',
  'lesblaguedemeh': 'Humour',
  'neck_ian': 'Fitness',
  'dylan4mma': 'Fitness',
  'unknownmma2.0': 'Gaming',
  'nobusinessfr': 'Business',
  'mathetbas': 'Business',
  'chadi_v2v': 'Business',
  'ohuncamping': 'Voyage',
  'ohunblond': 'Voyage',
  'byozer_cuisine': 'Cuisine',
  'kbenzelarigolade': 'Humour',
  'tdfmanga': 'Gaming'
};

// 📉 Générer des données de performance réalistes basées sur les vraies vues moyennes
function generatePerformanceData(avgViews) {
  const data = [];
  const days = ['J-7', 'J-6', 'J-5', 'J-4', 'J-3', 'J-2', 'Auj'];
  
  let current = avgViews * 0.6;
  
  for (let i = 0; i < 7; i++) {
    const variation = 1 + (Math.random() * 0.5 - 0.2);
    current = Math.max(avgViews * 0.3, current * variation);
    
    data.push({
      day: days[i],
      views: Math.round(current)
    });
  }
  
  return data;
}

// 🔢 Formater les nombres
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// 🎯 Créer un objet compte avec les VRAIES données TikTok
function createAccountObject(userInfo, videos, username) {
  const followers = userInfo.followerCount || 0;
  const totalLikes = userInfo.heartCount || 0;
  
  // Calculer les stats réelles des vidéos
  const totalViews = videos.reduce((sum, v) => sum + (v.play_count || 0), 0);
  const totalEngagement = videos.reduce((sum, v) => sum + (v.digg_count || 0) + (v.comment_count || 0) + (v.share_count || 0), 0);
  
  const avgViews = videos.length > 0 ? Math.round(totalViews / videos.length) : 0;
  const avgLikes = videos.length > 0 ? Math.round(videos.reduce((sum, v) => sum + (v.digg_count || 0), 0) / videos.length) : 0;
  const engagement = videos.length > 0 && totalViews > 0 ? ((totalEngagement / totalViews) * 100).toFixed(1) : 0;
  
  const category = CATEGORIES_MAP[username] || 'Divertissement';
  
  // ✅ FORMULE RPM/REVENUE - BASÉE SUR 30 JOURS RÉELS
  // Vues éligibles = totalViews des 30 derniers jours / 2
  // RPM moyen = 0.7-1$ (on prend aléatoire entre 0.7 et 1.0)
  // Revenue = (vues éligibles / 1000) * RPM
  // Les vidéos sont filtrées sur create_time (30 derniers jours seulement)
  const rpmMoyen = 0.7 + Math.random() * 0.3; // Random entre 0.7 et 1.0
  const vuesEligibles = totalViews / 2;
  const estimatedRevenue = Math.round((vuesEligibles / 1000) * rpmMoyen);
  const estimatedRPM = rpmMoyen.toFixed(2);
  
  return {
    username,
    displayName: userInfo.nickname || username,
    avatar: userInfo.avatarLarger ? `https://images.weserv.nl/?url=${encodeURIComponent(userInfo.avatarLarger)}&w=150&h=150&fit=cover` : `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
    followers: formatNumber(followers),
    bio: userInfo.signature || `Créateur TikTok - ${category}`,
    videoCount: userInfo.videoCount || videos.length,
    totalLikes: formatNumber(totalLikes),
    engagement: engagement,
    category,
    views30days: formatNumber(totalViews), // 📊 Vues des 30 derniers jours (vidéos filtrées par create_time)
    rpm: `€${estimatedRPM}`,
    revenue: `€${estimatedRevenue}`,
    avgViews: formatNumber(avgViews),
    performanceData: generatePerformanceData(avgViews),
    fetchedAt: new Date().toISOString(),
    tiktokUrl: `https://www.tiktok.com/@${username}`
  };
}

// 💾 Sauvegarder en cache Supabase
export async function cacheAccountsToSupabase(supabase, accounts) {
  try {
    const { error } = await supabase
      .from('monetizable_accounts')
      .upsert(
        accounts.map(acc => ({
          username: acc.username,
          data: JSON.stringify(acc),
          cached_at: new Date().toISOString()
        })),
        { onConflict: 'username' }
      );

    if (error) throw error;
    console.log('✅ Comptes cachés dans Supabase');
    return true;
  } catch (error) {
    console.error('❌ Erreur cache Supabase:', error);
    return false;
  }
}

// 🚀 Récupérer les VRAIS comptes depuis TikTok
export async function fetchAllMonetizableAccounts(supabase, fetchUserInfo, fetchUserVideos) {
  return fetchAllMonetizableAccountsWithProgress(supabase, fetchUserInfo, fetchUserVideos, null);
}

// 🚀 VERSION AVEC CALLBACK DE PROGRESSION
export async function fetchAllMonetizableAccountsWithProgress(supabase, fetchUserInfo, fetchUserVideos, onProgress = null) {
  console.log(`🔄 Récupération des VRAIS données pour ${ACCOUNTS_TO_TRACK.length} comptes...`);
  
  const accounts = [];
  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000); // 30 jours en millisecondes
  
  for (let index = 0; index < ACCOUNTS_TO_TRACK.length; index++) {
    const username = ACCOUNTS_TO_TRACK[index];
    
    try {
      // 📊 Mettre à jour la progression
      if (onProgress) {
        onProgress({
          accountsProcessed: index,
          totalAccounts: ACCOUNTS_TO_TRACK.length,
          currentAccount: username,
          stage: 'fetching'
        });
      }
      
      console.log(`📥 Fetching @${username}... (${index + 1}/${ACCOUNTS_TO_TRACK.length})`);
      
      // Récupérer les infos utilisateur (vrais followers, vrais avatar, etc.)
      const userInfo = await fetchUserInfo(username);
      
      if (!userInfo) {
        console.log(`⚠️ @${username} introuvable`);
        continue;
      }
      
      // Récupérer 50 vidéos pour couvrir 30 jours
      const allVideos = await fetchUserVideos(username, 50);
      
      // 🎯 FILTRER : garder seulement les vidéos des 30 derniers jours
      const videos30days = allVideos.filter(video => {
        // create_time est en secondes (timestamp Unix)
        const videoTimestamp = (video.create_time || 0) * 1000; // convertir en ms
        return videoTimestamp >= thirtyDaysAgo;
      });
      
      console.log(`📹 @${username} - ${videos30days.length}/${allVideos.length} vidéos dans les 30 derniers jours`);
      
      // Créer l'objet compte avec les VRAIES données des 30 derniers jours
      const account = createAccountObject(userInfo, videos30days, username);
      accounts.push(account);
      
      console.log(`✅ @${username} - ${userInfo.followerCount?.toLocaleString()} followers - ${account.views30days} vues`);
      
      // Pause pour éviter le rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`❌ Erreur @${username}:`, error.message);
    }
  }

  console.log(`📊 ${accounts.length}/${ACCOUNTS_TO_TRACK.length} comptes récupérés`);

  // Cacher en Supabase
  if (accounts.length > 0) {
    await cacheAccountsToSupabase(supabase, accounts);
  }

  return accounts;
}

// 📥 Récupérer depuis le cache Supabase
export async function getMonetizableAccountsFromCache(supabase) {
  try {
    const { data, error } = await supabase
      .from('monetizable_accounts')
      .select('data')
      .order('cached_at', { ascending: false });

    if (error) throw error;

    return data.map(row => JSON.parse(row.data));
  } catch (error) {
    console.error('❌ Erreur récupération cache:', error);
    return [];
  }
}