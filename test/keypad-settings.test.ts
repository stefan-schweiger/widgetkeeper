// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

/**
 * The app settings page's Keypad codes section, its script run unchanged against a stand-in for its routes (the strings
 * are their keys, tokens as JSON).
 */
it('Keypad codes: adds, changes with the current code, and removes with a second tap', () => {
  const html = readFileSync('settings/index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="text/javascript">', html.indexOf('<body>')));
  const script = html.slice(html.indexOf('function onHomeyReady'), html.lastIndexOf('</script>'));
  let codes: any[] = [];
  const calls: any[] = [];
  const Homey = {
    __: (k: string, tokens?: any) => `${k.replace('settings.', '')}${tokens ? JSON.stringify(tokens) : ''}`,
    get: (_k: string, cb: any) => cb(null, false),
    ready: () => {},
    set: (_k: string, _v: any, cb: any) => cb(null),
    api: (method: string, path: string, body: any, cb: any) => {
      calls.push([method, path, body]);
      if (path === '/keypad-codes' && method === 'GET') return cb(null, { codes });
      if (path === '/keypad-codes' && method === 'POST') { codes = [...codes, { id: 'a1', name: body.name, digits: body.code.length }]; return cb(null, { ok: true, codes }); }
      if (path.startsWith('/keypad-codes/') && method === 'PUT') {
        if (body.current !== '4711') return cb(null, { ok: false, reason: 'wrongCode' });
        codes = codes.map(c => ({ ...c, digits: body.code.length })); return cb(null, { ok: true, codes });
      }
      if (path.startsWith('/keypad-codes/') && method === 'DELETE') { codes = []; return cb(null, { ok: true, codes }); }
      return cb(null, {});
    },
  };
  new Function('Homey', `${script}\nonHomeyReady(Homey);`)(Homey);
  const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
  const typeIn = (id: string, v: string) => { $(id).value = v; $(id).dispatchEvent(new Event('input')); };
  expect($('kpEmpty').hidden).toBe(false);
  typeIn('kpName', 'Alarm');
  typeIn('kpCode', '47a11');
  expect($('kpCode').value).toBe('4711');
  expect(($('kpSave') as any).disabled).toBe(true);
  typeIn('kpAgain', '4712');
  ($('kpSave') as any).click();
  expect($('kpStatus').textContent).toBe('kpMismatch');
  typeIn('kpAgain', '4711');
  ($('kpSave') as any).click();
  expect(calls.at(-1)).toEqual(['POST', '/keypad-codes', { name: 'Alarm', code: '4711' }]);
  expect(document.querySelector('#kpList li')!.textContent).toBe('AlarmkpDigits{"n":4}kpChangekpRemove');
  expect($('kpStatus').textContent).toBe('kpAdded');
  // Change: the current code, then new digits twice.
  (document.querySelectorAll('#kpList button')[0] as HTMLButtonElement).click();
  expect([$('kpNameGroup').hidden, $('kpCurrentGroup').hidden, $('kpChanging').textContent]).toEqual([true, false, 'kpChanging{"name":"Alarm"}']);
  typeIn('kpCurrent', '0000'); typeIn('kpCode', '246810'); typeIn('kpAgain', '246810');
  ($('kpSave') as any).click();
  expect($('kpStatus').textContent).toBe('kpWrong');
  typeIn('kpCurrent', '4711');
  ($('kpSave') as any).click();
  expect(calls.at(-1)).toEqual(['PUT', '/keypad-codes/a1', { current: '4711', code: '246810' }]);
  expect(document.querySelector('#kpList li')!.textContent).toContain('kpDigits{"n":6}');
  expect($('kpNameGroup').hidden).toBe(false);
  // Remove: a second tap.
  const remove = () => document.querySelectorAll('#kpList button')[1] as HTMLButtonElement;
  remove().click();
  expect(remove().textContent).toBe('kpRemoveAgain');
  remove().click();
  expect(calls.at(-1)).toEqual(['DELETE', '/keypad-codes/a1', null]);
  expect($('kpEmpty').hidden).toBe(false);
  expect($('kpStatus').textContent).toBe('kpRemoved');
});
