/* ============ ChainPlus Consent Management ============ */
(function(){
  'use strict';
  const CONSENT_KEY = 'cp-consent';
  const GTM_ID = 'GTM-T8P3MVPH';

  // Consent state: 'granted' | 'denied' | null
  function getConsent(){ try { return localStorage.getItem(CONSENT_KEY); } catch(e){ return null; } }
  function setConsent(val){ try { localStorage.setItem(CONSENT_KEY, val); } catch(e){} }

  // Initialize dataLayer
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;

  // Consent Mode v2 defaults (denied until user chooses)
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  // GTM is loaded statically in HTML <head> with consent mode defaults.
  // Consent Mode v2 controls whether GTM fires tags based on consent state.

  // AdSense script is loaded statically in HTML <head> with consent mode defaults.
  // Consent Mode v2 (set above) ensures non-personalized ads until consent granted.

  // Show consent banner
  function showBanner(){
    const b = document.getElementById('consent-banner');
    if(b) b.style.display = 'flex';
    else { setTimeout(showBanner, 100); }
  }
  function hideBanner(){
    const b = document.getElementById('consent-banner');
    if(b) b.style.display = 'none';
  }

  // Handle accept
  window.cpAcceptConsent = function(){
    setConsent('granted');
    hideBanner();
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted'
    });
  };
  // Handle reject
  window.cpRejectConsent = function(){
    setConsent('denied');
    hideBanner();
    gtag('consent', 'update', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied'
    });
  };
  // Reopen preferences
  window.cpOpenConsent = function(){
    showBanner();
  };

  // On load: check consent
  function initConsent(){
    const consent = getConsent();
    if(consent === 'granted'){
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted'
      });
      } else if(consent === null){
      showBanner();
    }
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initConsent);
  } else {
    initConsent();
  }
  // If 'denied', AdSense serves non-personalized ads; GTM stays off
})();
