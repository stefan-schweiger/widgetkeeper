/*
 * `?lang=de` on a preview page: a `t()` like `Homey.__` that reads locales/<lang>.json, served
 * from the repo root. Without the parameter, `devT` is undefined and the widgets use English.
 */
const devT = (() => {
  const lang = new URLSearchParams(location.search).get('lang');
  if (!lang) return undefined;
  document.documentElement.lang = lang;
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `/locales/${lang}.json`, false); // sync, so the preview scripts stay synchronous
  xhr.send();
  const strings = JSON.parse(xhr.responseText);
  return (key, tokens) => {
    const s = key.split('.').reduce((o, k) => (o ? o[k] : undefined), strings);
    return typeof s === 'string' ? s.replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : '')) : key;
  };
})();
