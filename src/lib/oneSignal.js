import OneSignal from 'react-onesignal'

const APP_ID = 'eedcef3b-5612-48ad-ac57-5e1e9f19abbc'

let readyPromise = null

// Initialises the SDK exactly once and returns a promise other modules can
// await before calling any other OneSignal.* method — calling those before
// init() resolves can throw.
export function oneSignalReady() {
  if (!readyPromise) {
    readyPromise = OneSignal.init({
      appId: APP_ID,
      allowLocalhostAsSecureOrigin: true,
    })
  }
  return readyPromise
}

export { OneSignal }
