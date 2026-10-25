// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

/**
 * The app settings page, its script run unchanged against a stand-in for its routes and app settings (the strings are
 * their keys, tokens as JSON). `routes(method, path, body)` answers a call; anything else answers `{}`.
 */
function loadPage(routes: (method: string, path: string, body: any) => any, settings: Record<string, any> = {}) {
  const html = readFileSync('settings/index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="text/javascript">', html.indexOf('<body>')));
  const script = html.slice(html.indexOf('function onHomeyReady'), html.lastIndexOf('</script>'));
  const calls: any[] = [];
  const Homey = {
    __: (k: string, tokens?: any) => `${k.replace('settings.', '')}${tokens ? JSON.stringify(tokens) : ''}`,
    get: (k: string, cb: any) => cb(null, settings[k]),
    ready: () => {},
    set: (k: string, v: any, cb: any) => { settings[k] = v; cb(null); },
    api: (method: string, path: string, body: any, cb: any) => {
      calls.push([method, path, body]);
      cb(null, routes(method, path, body) ?? {});
    },
  };
  new Function('Homey', `${script}\nonHomeyReady(Homey);`)(Homey);
  const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
  const typeIn = (id: string, v: string) => { $(id).value = v; $(id).dispatchEvent(new Event('input')); };
  const click = (id: string) => ($(id) as unknown as HTMLButtonElement).click();
  return { calls, $, typeIn, click };
}

it('Keypad codes: adds, changes with the current code, and removes with a second tap', () => {
  let codes: any[] = [];
  const { calls, $, typeIn, click } = loadPage((method, path, body) => {
    if (path === '/keypad-codes' && method === 'GET') return { codes };
    if (path === '/keypad-codes' && method === 'POST') { codes = [...codes, { id: 'a1', name: body.name, digits: body.code.length }]; return { ok: true, codes }; }
    if (path.startsWith('/keypad-codes/') && method === 'PUT') {
      if (body.current !== '4711') return { ok: false, reason: 'wrongCode' };
      codes = codes.map(c => ({ ...c, digits: body.code.length })); return { ok: true, codes };
    }
    if (path.startsWith('/keypad-codes/') && method === 'DELETE') { codes = []; return { ok: true, codes }; }
  });
  expect($('kpLine').textContent).toBe('kpNone');
  // The form opens on Add code, in place of the button.
  expect([$('kpForm').hidden, $('kpActions').hidden]).toEqual([true, false]);
  click('kpNew');
  expect([$('kpForm').hidden, $('kpActions').hidden]).toEqual([false, true]);
  typeIn('kpName', 'Alarm');
  typeIn('kpCode', '47a11');
  expect($('kpCode').value).toBe('4711');
  expect($('kpSave').disabled).toBe(true);
  typeIn('kpAgain', '4712');
  click('kpSave');
  expect($('kpStatus').textContent).toBe('kpMismatch');
  typeIn('kpAgain', '4711');
  click('kpSave');
  expect(calls.at(-1)).toEqual(['POST', '/keypad-codes', { name: 'Alarm', code: '4711' }]);
  expect(document.querySelector('#kpList li')!.textContent).toBe('AlarmkpDigits{"n":4}kpChangekpRemove');
  expect($('kpStatus').textContent).toBe('kpAdded');
  expect([$('kpForm').hidden, $('kpLine').textContent]).toEqual([true, 'Alarm']);
  // Change: the current code, then new digits twice.
  (document.querySelectorAll('#kpList button')[0] as HTMLButtonElement).click();
  expect([$('kpForm').hidden, $('kpNameGroup').hidden, $('kpCurrentGroup').hidden, $('kpChanging').textContent]).toEqual([false, true, false, 'kpChanging{"name":"Alarm"}']);
  typeIn('kpCurrent', '0000'); typeIn('kpCode', '246810'); typeIn('kpAgain', '246810');
  click('kpSave');
  expect($('kpStatus').textContent).toBe('kpWrong');
  typeIn('kpCurrent', '4711');
  click('kpSave');
  expect(calls.at(-1)).toEqual(['PUT', '/keypad-codes/a1', { current: '4711', code: '246810' }]);
  expect(document.querySelector('#kpList li')!.textContent).toContain('kpDigits{"n":6}');
  expect([$('kpForm').hidden, $('kpNameGroup').hidden]).toEqual([true, false]);
  // Remove: a second tap.
  const remove = () => document.querySelectorAll('#kpList button')[1] as HTMLButtonElement;
  remove().click();
  expect(remove().textContent).toBe('kpRemoveAgain');
  remove().click();
  expect(calls.at(-1)).toEqual(['DELETE', '/keypad-codes/a1', null]);
  expect($('kpLine').textContent).toBe('kpNone');
  expect($('kpStatus').textContent).toBe('kpRemoved');
});

it('API key: the field without a key, Replace key and Remove with one; the line says which', () => {
  let set = false;
  const { calls, $, typeIn, click } = loadPage((method, path, body) => {
    if (path === '/variables-key' && method === 'GET') return { set };
    if (path === '/variables-key' && method === 'PUT') { set = !!body.key; return { ok: true, variables: true, flows: true }; }
  });
  expect([$('varLine').textContent, $('varLine').classList.contains('ok'), $('varState').hidden]).toEqual(['varLineNone', false, false]);
  expect([$('varForm').hidden, $('varActions').hidden, $('varCancel').hidden]).toEqual([false, true, true]);
  typeIn('varKey', ' k1 ');
  click('varSave');
  expect(calls.at(-1)).toEqual(['GET', '/variables-key', null]);
  expect(calls.at(-2)).toEqual(['PUT', '/variables-key', { key: 'k1' }]);
  expect([$('varLine').textContent, $('varLine').classList.contains('ok'), $('varState').hidden]).toEqual(['varIsSet', true, true]);
  expect([$('varForm').hidden, $('varActions').hidden]).toEqual([true, false]);
  // Replace key opens the field with Cancel; Cancel empties and closes it.
  click('varReplace');
  expect([$('varForm').hidden, $('varActions').hidden, $('varCancel').hidden]).toEqual([false, true, false]);
  typeIn('varKey', 'k2');
  click('varCancel');
  expect([$('varForm').hidden, $('varKey').value]).toEqual([true, '']);
  click('varRemove');
  expect(calls.at(-2)).toEqual(['PUT', '/variables-key', { key: '' }]);
  expect([$('varLine').textContent, $('varForm').hidden, $('varStatus').textContent]).toEqual(['varLineNone', false, 'varRemoved']);
});

it('Web dashboards: the line, the password form for a new one or the current one only, Diagnostics read once opened', () => {
  let password = true;
  const { calls, $, typeIn, click } = loadPage((method, path, body) => {
    if (path === '/web/password' && method === 'GET') return { set: password };
    if (path === '/web/password' && method === 'PUT') {
      if (body.current !== 'old-one!') return { ok: false, reason: 'wrong' };
      password = !!body.password; return { ok: true };
    }
    if (path === '/web/address') return { url: 'http://192.168.1.20/app/x/settings/dashboard.html' };
    if (path.startsWith('/diagnostics')) return { app: 'x', devices: [{ id: 'd1', name: 'Lamp' }] };
  }, { webDashboardsEnabled: true, webRemoteAccess: false });
  expect($('webLine').textContent).toBe('webLineHome · webLinePassword');
  expect(($('webOn').querySelector('.web-address') as HTMLElement).hidden).toBe(false);
  click('webRemote');
  expect($('webLine').textContent).toBe('webLineAway · webLinePassword');
  // Change password: the current one and a new one.
  expect([$('pwSet').textContent, $('pwRemove').hidden, $('pwState').hidden, $('pwForm').hidden]).toEqual(['webPasswordChange', false, false, true]);
  click('pwSet');
  expect([$('pwForm').hidden, $('pwActions').hidden, $('pwCurrentGroup').hidden, $('pwNewGroup').hidden, $('pwSave').textContent]).toEqual([false, true, false, false, 'webPasswordSave']);
  typeIn('webPassword', 'new-one!');
  expect($('pwSave').disabled).toBe(true);
  typeIn('pwCurrent', 'wrong');
  click('pwSave');
  expect($('pwStatus').textContent).toBe('webPasswordWrong');
  typeIn('pwCurrent', 'old-one!');
  click('pwSave');
  expect(calls.find(c => c[0] === 'PUT')).toEqual(['PUT', '/web/password', { password: 'new-one!', current: 'wrong' }]);
  expect(calls.filter(c => c[0] === 'PUT').at(-1)).toEqual(['PUT', '/web/password', { password: 'new-one!', current: 'old-one!' }]);
  expect([$('pwForm').hidden, $('pwStatus').textContent]).toEqual([true, 'webPasswordSaved']);
  // Remove password: the current one only.
  click('pwRemove');
  expect([$('pwCurrentGroup').hidden, $('pwNewGroup').hidden, $('pwSave').textContent]).toEqual([false, true, 'webPasswordRemove']);
  typeIn('pwCurrent', 'old-one!');
  click('pwSave');
  expect(calls.filter(c => c[0] === 'PUT').at(-1)).toEqual(['PUT', '/web/password', { password: '', current: 'old-one!' }]);
  expect([$('pwSet').textContent, $('pwRemove').hidden, $('pwState').hidden, $('webLine').textContent]).toEqual(['webPasswordSave', true, true, 'webLineAway']);
  // Turned off, the line says so.
  click('webEnabled');
  expect([$('webLine').textContent, $('webOn').hidden]).toEqual(['webLineOff', true]);
  // Diagnostics: not read until its card opens.
  expect(calls.some(c => c[1].startsWith('/diagnostics'))).toBe(false);
  const card = $('diagCard') as unknown as HTMLDetailsElement;
  card.open = true;
  card.dispatchEvent(new Event('toggle'));
  expect(calls.filter(c => c[1].startsWith('/diagnostics')).length).toBe(1);
  expect(($('device') as unknown as HTMLSelectElement).options.length).toBe(2);
});
