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

  // Load GTM only if consent granted
  function loadGTM(){
    if(window.__gtmLoaded) return;
    window.__gtmLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GTM_ID);
  }

  // Load AdSense always — serves non-personalized ads when consent is denied
  const ADSENSE_CLIENT = 'ca-pub-8503915493262909';
  function loadAdSense(){
    if(window.__adsenseLoaded) return;
    window.__adsenseLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + ADSENSE_CLIENT;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
  }
  // Load AdSense immediately (non-personalized by default until consent)
  loadAdSense();

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
    loadGTM();
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
      loadGTM();
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
