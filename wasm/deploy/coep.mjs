// Deliberately conservative: other browsers retain the established relay policy.
export function supportsCredentialless(ua = '') {
  return /(?:Chrome|Chromium)\/(\d+)/.test(ua) && Number(ua.match(/(?:Chrome|Chromium)\/(\d+)/)[1]) >= 110 && !/EdgiOS|CriOS|Firefox|; wv\)/.test(ua);
}
export function embedderPolicy(mode, ua) {
  return mode === 'credentialless' && supportsCredentialless(ua) ? 'credentialless' : 'require-corp';
}
