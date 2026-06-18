import { fetchAllMonetizableAccounts, getMonetizableAccountsFromCache } from './monetizable-accounts.js';

// À importer depuis server.js (les vraies fonctions TikTok)
// Elles sont passées en paramètre à setupMonetizableRoutes

export function setupMonetizableRoutes(app, supabase, fetchTikTokUserInfo, fetchTikTokUserVideos) {
  
  // 📊 GET : Récupérer les comptes (depuis cache)
  app.get('/api/monetizable-accounts/accounts', async (req, res) => {
    try {
      console.log('📥 GET /api/monetizable-accounts/accounts');

      const accounts = await getMonetizableAccountsFromCache(supabase);

      if (!accounts || accounts.length === 0) {
        return res.json({
          success: false,
          message: 'Aucun compte en cache. Lance /refresh d\'abord.',
          data: []
        });
      }

      res.json({
        success: true,
        count: accounts.length,
        data: accounts
      });

    } catch (error) {
      console.error('❌ Erreur GET accounts:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message,
        data: []
      });
    }
  });

  // 🔄 POST : Rafraîchir les comptes (fetch TikTok)
  app.post('/api/monetizable-accounts/refresh', async (req, res) => {
    try {
      console.log('🔄 POST /api/monetizable-accounts/refresh - Démarrage du fetch TikTok');

      // Utiliser les VRAIES fonctions TikTok
      const accounts = await fetchAllMonetizableAccounts(
        supabase, 
        fetchTikTokUserInfo, 
        fetchTikTokUserVideos
      );

      console.log(`✅ Refresh terminé : ${accounts.length} comptes`);

      res.json({
        success: true,
        message: `${accounts.length} comptes fetchés et cachés`,
        count: accounts.length
      });

    } catch (error) {
      console.error('❌ Erreur POST refresh:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  console.log('✅ Routes comptes monétisés configurées (vraies données TikTok)');
}