// Combined service worker: imports the app's existing PWA/offline worker
// first, then the OneSignal Web SDK worker. This site already has a service
// worker at the root scope (/sw.js) — OneSignal's guidance for that case is
// to merge scripts into this file rather than register a second, competing
// worker at the same scope. See:
// https://documentation.onesignal.com/docs/web-push-custom-code-setup
importScripts('/sw.js');
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
