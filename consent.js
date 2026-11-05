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
    loadGTM();
  };
  // Handle reject
  window.cpRejectConsent = function(){
    setConsent('denied');
    hideBanner();
  };
  // Reopen preferences
  window.cpOpenConsent = function(){
    showBanner();
  };

  // On load: check consent
  function initConsent(){
    const consent = getConsent();
    if(consent === 'granted'){
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
  // If 'denied', do nothing (no tracking)
})();
