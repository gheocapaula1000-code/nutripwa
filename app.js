/* NutriPWA – app.js
 * Privacy-first: tutto resta nel browser (IndexedDB + localStorage). Nessun backend obbligatorio.
 * Le chiamate AI partono direttamente dal browser con la chiave dell'utente (BYOK) oppure da un proxy facoltativo.
 */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NUT = ['kcal', 'proteine_g', 'carboidrati_g', 'grassi_g', 'fibra_g'];
  var NUT_LABEL = { kcal: 'Calorie', proteine_g: 'Proteine', carboidrati_g: 'Carboidrati', grassi_g: 'Grassi', fibra_g: 'Fibre' };
  var NUT_UNIT = { kcal: 'kcal', proteine_g: 'g', carboidrati_g: 'g', grassi_g: 'g', fibra_g: 'g' };
  var NUT_COLOR = { kcal: 'var(--kcal)', proteine_g: 'var(--prot)', carboidrati_g: 'var(--carb)', grassi_g: 'var(--fat)', fibra_g: 'var(--fib)' };
  var DEFAULT_GOALS = { kcal: 2000, proteine_g: 75, carboidrati_g: 250, grassi_g: 70, fibra_g: 25 };
  var PRESETS = {
    openrouter: { base: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
    groq: { base: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    custom: { base: '', model: '' }
  };
  var TIPI = { colazione: '🥐', pranzo: '🍝', cena: '🍲', spuntino: '🍎' };

  /* ---------- utilità ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { if (typeof v === 'string') v = parseFloat(v.replace(',', '.')); return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : (d || 0); }
  var nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
  var nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
  function f1(n) { return nf1.format(n); }
  function f0(n) { return nf0.format(n); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(ds, n) { var p = ds.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return dayStr(d); }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
  };
  function AppError(code, title, text, retry) { this.code = code; this.title = title; this.text = text || ''; this.retry = !!retry; }
  AppError.prototype = new Error();

  /* ---------- impostazioni ---------- */
  function getSettings() {
    var s = LS.get('nutri.settings', {}) || {};
    s.alt = s.alt || { preset: 'openrouter', base: PRESETS.openrouter.base, model: PRESETS.openrouter.model, key: '' };
    return s;
  }
  function saveSettings(s) { if (!LS.set('nutri.settings', s)) showAlert({ type: 'err', title: 'Impossibile salvare', text: 'Il browser non permette di salvare le impostazioni (modalità privata o memoria piena).' }); }
  function getGoals() { return Object.assign({}, DEFAULT_GOALS, LS.get('nutri.goals', {})); }
  function hasProvider() { var s = getSettings(); return !!(s.gemKey || s.proxy || (s.alt && s.alt.key)); }
  function applyTheme() {
    var s = getSettings(), r = document.documentElement;
    r.setAttribute('data-theme', s.theme === 'light' || s.theme === 'dark' ? s.theme : 'auto');
    r.style.setProperty('--fs', String(parseFloat(s.size) || 1));
  }

  /* ---------- IndexedDB (con ripiego in memoria) ---------- */
  var DB = (function () {
    var db = null, mem = null, nextId = 1;
    function open() {
      if (db || mem) return Promise.resolve();
      return new Promise(function (res) {
        if (!window.indexedDB) { mem = []; return res(); }
        var rq;
        try { rq = indexedDB.open('nutripwa', 1); } catch (e) { mem = []; return res(); }
        rq.onupgradeneeded = function () {
          var st = rq.result.createObjectStore('meals', { keyPath: 'id', autoIncrement: true });
          st.createIndex('date', 'date');
        };
        rq.onsuccess = function () { db = rq.result; res(); };
        rq.onerror = rq.onblocked = function () { mem = []; res(); };
      });
    }
    function run(mode, fn) {
      return open().then(function () {
        return new Promise(function (res, rej) {
          var t = db.transaction('meals', mode), st = t.objectStore('meals'), out;
          out = fn(st);
          t.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); };
          t.onerror = t.onabort = function () { rej(t.error || new Error('db')); };
        });
      });
    }
    return {
      all: function () { return open().then(function () { return mem ? mem.slice() : run('readonly', function (s) { return s.getAll(); }); }); },
      byDate: function (d) { return this.all().then(function (a) { return a.filter(function (m) { return m.date === d; }).sort(function (x, y) { return x.ts - y.ts; }); }); },
      get: function (id) { return open().then(function () { return mem ? mem.filter(function (m) { return m.id === id; })[0] : run('readonly', function (s) { return s.get(id); }); }); },
      put: function (m) {
        return open().then(function () {
          if (mem) { if (!m.id) m.id = nextId++; mem = mem.filter(function (x) { return x.id !== m.id; }); mem.push(m); return m.id; }
          return run('readwrite', function (s) { return s.put(m); });
        });
      },
      del: function (id) { return open().then(function () { if (mem) { mem = mem.filter(function (x) { return x.id !== id; }); return; } return run('readwrite', function (s) { return s.delete(id); }); }); },
      clear: function () { return open().then(function () { if (mem) { mem = []; return; } return run('readwrite', function (s) { return s.clear(); }); }); },
      isMem: function () { return !!mem; }
    };
  })();

  /* ---------- messaggi ---------- */
  function showAlert(o) {
    var box = $('#alerts');
    var el = document.createElement('div');
    el.className = 'alert ' + (o.type || 'err');
    el.setAttribute('role', o.type === 'err' ? 'alert' : 'status');
    el.innerHTML = '<span class="ic" aria-hidden="true">' + (o.type === 'ok' ? '✅' : o.type === 'warn' ? '⚠️' : '❌') + '</span>' +
      '<div class="body"><strong>' + esc(o.title) + '</strong>' + (o.text ? '<span>' + esc(o.text) + '</span>' : '') + '<div class="acts"></div></div>' +
      '<button class="x" type="button" aria-label="Chiudi il messaggio">✕</button>';
    $('.x', el).onclick = function () { el.remove(); };
    (o.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn sec inline'; b.style.marginTop = '.5rem'; b.style.marginRight = '.4rem';
      b.textContent = a.label; b.onclick = function () { el.remove(); a.fn(); };
      $('.acts', el).appendChild(b);
    });
    box.innerHTML = ''; box.appendChild(el);
    if (o.type === 'ok') setTimeout(function () { el.remove(); }, 6000);
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function clearAlerts() { $('#alerts').innerHTML = ''; }
  function toast(t) {
    var el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = t;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 2800);
  }
  function ask(msg, okLabel) {
    return new Promise(function (res) {
      var d = document.createElement('dialog');
      d.style.cssText = 'border:0;border-radius:1rem;padding:1.2rem;max-width:90vw;width:26rem;background:var(--card);color:var(--text)';
      d.innerHTML = '<p style="font-size:1.1rem">' + esc(msg) + '</p><div class="btns"><button class="btn warn" type="button" data-r="1">' + esc(okLabel || 'Conferma') + '</button><button class="btn sec" type="button" data-r="0">Annulla</button></div>';
      document.body.appendChild(d);
      function end(v) { try { d.close(); } catch (e) { /* */ } d.remove(); res(v); }
      d.addEventListener('click', function (e) { var r = e.target.getAttribute && e.target.getAttribute('data-r'); if (r != null) end(r === '1'); });
      d.addEventListener('cancel', function () { end(false); });
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    });
  }

  /* ---------- immagini ---------- */
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new AppError('IMG', 'Foto non leggibile', 'Questo formato di immagine non è supportato dal browser. Prova con una foto JPG o PNG (su iPhone: Impostazioni › Fotocamera › Formati › “Più compatibile”).')); };
      img.src = url;
    });
  }
  function toJpeg(src, max, q) {
    var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    var k = Math.min(1, max / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }

  /* ---------- cibo: modello dati ---------- */
  function mkFood(raw, fromBase) {
    var peso = num(raw.peso_g, 0) || 100;
    var f = { nome: String(raw.nome || 'Alimento').slice(0, 80), peso_g: peso, fonte: raw.fonte || 'AI' };
    f.b = fromBase ? raw.b : { peso: peso };
    if (!fromBase) NUT.forEach(function (n) { f.b[n] = num(raw[n]); });
    recalcFood(f); return f;
  }
  function recalcFood(f) {
    var k = f.b.peso > 0 ? f.peso_g / f.b.peso : 1;
    NUT.forEach(function (n) { f[n] = Math.round(num(f.b[n]) * k * 10) / 10; });
  }
  function totals(foods) {
    var t = {}; NUT.forEach(function (n) { t[n] = 0; });
    foods.forEach(function (f) { NUT.forEach(function (n) { t[n] += num(f[n]); }); });
    NUT.forEach(function (n) { t[n] = Math.round(t[n] * 10) / 10; }); return t;
  }

  /* ---------- AI ---------- */
  function buildPrompt(hint) {
    return 'Sei un esperto nutrizionista. Analizza questa foto di un piatto (cucina italiana o internazionale).\n' +
      '1. Identifica tutti gli alimenti visibili, con nomi in italiano.\n' +
      '2. Stima il peso di ciascuna porzione in grammi (usa riferimenti visivi come piatto da ~25 cm, posate, mani).\n' +
      '3. Per ogni alimento calcola i valori nutrizionali per la porzione stimata, fibre incluse.\n' +
      (hint ? '\nInformazione dell\'utente (da considerare attendibile): "' + hint.replace(/"/g, "'") + '"\n' : '') +
      '\nRispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo extra, in questo formato:\n' +
      '{\n  "alimenti": [\n    {"nome": "string", "peso_g": number, "kcal": number, "proteine_g": number, "carboidrati_g": number, "grassi_g": number, "fibra_g": number}\n  ],\n' +
      '  "totale": {"kcal": number, "proteine_g": number, "carboidrati_g": number, "grassi_g": number, "fibra_g": number},\n' +
      '  "note": "string breve in italiano (incertezze o consigli)",\n  "affidabilita": "alta|media|bassa"\n}\n' +
      'Se la foto non contiene cibo, rispondi {"error": "immagine non riconosciuta come cibo"}.';
  }
  function httpError(status, body, prov) {
    var msg = ''; try { msg = (body && (body.error && (body.error.message || body.error) || body.message)) || ''; } catch (e) { /* */ }
    msg = typeof msg === 'string' ? msg : JSON.stringify(msg);
    var lm = msg.toLowerCase();
    if (status === 400 && (lm.indexOf('api key') >= 0 || lm.indexOf('api_key') >= 0)) return new AppError('KEY', 'La chiave non è valida', 'Controlla di averla copiata per intero, senza spazi. Puoi crearne una nuova gratis su aistudio.google.com.', true);
    if (status === 401 || status === 403) return new AppError('KEY', 'La chiave non è accettata', 'Il servizio (' + prov + ') ha rifiutato la chiave: potrebbe essere errata, scaduta o senza permessi. Controllala nelle Impostazioni.', true);
    if (status === 404) return new AppError('MODEL', 'Modello non trovato', 'Il nome del modello (' + prov + ') non esiste o non è disponibile per la tua chiave. Controllalo nelle Impostazioni.', true);
    if (status === 413) return new AppError('BIG', 'Foto troppo grande', 'Riprova con un’altra foto.', false);
    if (status === 429) return new AppError('QUOTA', 'Limite gratuito raggiunto', 'Hai fatto molte richieste in poco tempo o finito la quota di oggi (' + prov + '). Aspetta un minuto e riprova, oppure aggiungi un provider alternativo nelle Impostazioni.', true);
    if (status >= 500) return new AppError('SERVER', 'Il servizio AI è momentaneamente occupato', prov + ' non risponde in questo momento. Riprova tra poco.', true);
    if (status === 400) return new AppError('BAD', 'Richiesta non accettata', (prov + ': ' + msg).slice(0, 200), false);
    return new AppError('HTTP', 'Errore imprevisto (' + status + ')', (msg || '').slice(0, 200), true);
  }
  function netError(e, signal) {
    if (e instanceof AppError) return e;
    if (e && e.name === 'AbortError') return new AppError(signal && signal.timedOut ? 'TIMEOUT' : 'ABORT', signal && signal.timedOut ? 'Tempo scaduto' : 'Analisi annullata', signal && signal.timedOut ? 'Il servizio ci mette troppo a rispondere. Riprova.' : '', !!(signal && signal.timedOut));
    if (navigator.onLine === false) return new AppError('OFFLINE', 'Sei offline', 'Non c’è connessione a internet. Collegati al Wi-Fi o ai dati mobili e riprova.', false);
    return new AppError('NET', 'Non riesco a collegarmi al servizio', 'Controlla la connessione. Se usi un proxy o un indirizzo personalizzato, verifica che sia corretto e che permetta l’accesso dal browser (CORS).', true);
  }
  function callGemini(s, prompt, b64, signal) {
    var model = (s.gemModel || 'gemini-2.5-flash').trim();
    var url = s.proxy ? s.proxy : 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    var headers = { 'Content-Type': 'application/json' };
    if (!s.proxy) headers['x-goog-api-key'] = s.gemKey;
    var body = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } };
    if (s.proxy) body.model = model;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: signal, cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (!r.ok) throw httpError(r.status, d, s.proxy ? 'proxy' : 'Gemini');
        var c = d && d.candidates && d.candidates[0];
        if (d && d.promptFeedback && d.promptFeedback.blockReason) throw new AppError('SAFETY', 'Foto non analizzabile', 'Il servizio ha bloccato l’immagine. Prova con un’altra foto del piatto.', false);
        var text = c && c.content && c.content.parts && c.content.parts.map(function (p) { return p.text || ''; }).join('');
        if (!text) throw new AppError('EMPTY', 'Risposta vuota', 'L’AI non ha dato una risposta utile. Riprova, magari con una foto più luminosa.', true);
        return text;
      });
    });
  }
  function callOpenAI(a, prompt, dataUrl, signal) {
    var url = String(a.base || '').replace(/\/+$/, '') + '/chat/completions';
    var body = { model: a.model, temperature: 0.2, max_tokens: 1500, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }] };
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + a.key }, body: JSON.stringify(body), signal: signal, cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (!r.ok) throw httpError(r.status, d, 'provider alternativo');
        var text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if (Array.isArray(text)) text = text.map(function (p) { return p.text || ''; }).join('');
        if (!text) throw new AppError('EMPTY', 'Risposta vuota', 'Il provider alternativo non ha risposto. Verifica che il modello sappia leggere le immagini.', true);
        return text;
      });
    });
  }
  function parseAI(text) {
    var t = String(text).replace(/```(?:json)?/gi, '').trim();
    var i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j <= i) throw new AppError('PARSE', 'Risposta non comprensibile', 'L’AI non ha risposto nel formato atteso. Riprova.', true);
    var o; try { o = JSON.parse(t.slice(i, j + 1)); } catch (e) { throw new AppError('PARSE', 'Risposta non comprensibile', 'L’AI non ha risposto nel formato atteso. Riprova.', true); }
    if (o.error) throw new AppError('NOFOOD', 'Non vedo del cibo in questa foto', 'Prova a inquadrare il piatto dall’alto, da vicino e con più luce.', false);
    var foods = (Array.isArray(o.alimenti) ? o.alimenti : []).map(function (a) { return mkFood(a); });
    if (!foods.length && o.totale) { var t0 = o.totale; foods = [mkFood({ nome: 'Piatto', peso_g: 100, kcal: t0.kcal, proteine_g: t0.proteine_g, carboidrati_g: t0.carboidrati_g, grassi_g: t0.grassi_g, fibra_g: t0.fibra_g })]; }
    if (!foods.length) throw new AppError('NOFOOD', 'Non ho riconosciuto alimenti', 'Prova con un’altra foto, più vicina e luminosa.', false);
    var aff = ['alta', 'media', 'bassa'].indexOf(String(o.affidabilita).toLowerCase()) >= 0 ? String(o.affidabilita).toLowerCase() : 'media';
    return { foods: foods, note: String(o.note || '').slice(0, 500), aff: aff };
  }
  function analyze(dataUrl, hint, signal) {
    var s = getSettings(), prompt = buildPrompt(hint), b64 = dataUrl.split(',')[1];
    var chain = [];
    if (s.gemKey || s.proxy) chain.push(function () { return callGemini(s, prompt, b64, signal); });
    if (s.alt && s.alt.key && s.alt.base && s.alt.model) chain.push(function () { return callOpenAI(s.alt, prompt, dataUrl, signal); });
    if (!chain.length) return Promise.reject(new AppError('NOKEY', 'Manca la chiave', 'Inserisci prima la tua chiave gratuita (passo 1).', false));
    var firstErr = null;
    function next(i) {
      return chain[i]().then(parseAI, function (e) {
        e = netError(e, signal);
        if (!firstErr) firstErr = e;
        var canFallback = e.retry && e.code !== 'TIMEOUT' && i + 1 < chain.length;
        if (!canFallback) throw firstErr;
        $('#loading-txt').textContent = 'Il primo servizio non risponde, provo il provider alternativo…';
        return next(i + 1);
      });
    }
    return next(0).catch(function (e) {
      if (e instanceof AppError) throw e;
      throw netError(e, signal);
    });
  }

  /* ---------- Open Food Facts ---------- */
  function offNut(n) {
    if (!n) return null;
    var kcal = n['energy-kcal_100g'];
    if (kcal == null && n['energy_100g'] != null) kcal = num(n['energy_100g']) / 4.184;
    if (kcal == null) return null;
    return { kcal: Math.round(num(kcal) * 10) / 10, proteine_g: num(n['proteins_100g']), carboidrati_g: num(n['carbohydrates_100g']), grassi_g: num(n['fat_100g']), fibra_g: num(n['fiber_100g']) };
  }
  function offFetch(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new AppError('OFF', 'Open Food Facts non risponde', 'Riprova tra poco (errore ' + r.status + ').', true);
      return r.json();
    }).catch(function (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('OFF', navigator.onLine === false ? 'Sei offline' : 'Non riesco a contattare Open Food Facts', 'Controlla la connessione e riprova.', true);
    });
  }
  function offSearch(q) {
    var url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(q) + '&search_simple=1&action=process&json=1&page_size=8&lc=it&fields=code,product_name,brands,nutriments';
    return offFetch(url).then(function (d) {
      return ((d && d.products) || []).map(function (p) { return { code: p.code, nome: p.product_name || '', marca: p.brands || '', per100: offNut(p.nutriments) }; }).filter(function (p) { return p.nome && p.per100; }).slice(0, 5);
    });
  }
  function offProduct(code) {
    var url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=product_name,product_name_it,brands,nutriments,serving_size,serving_quantity,quantity';
    return offFetch(url).then(function (d) {
      if (!d || d.status !== 1 || !d.product) return null;
      var p = d.product;
      return { code: code, nome: p.product_name_it || p.product_name || 'Prodotto', marca: p.brands || '', per100: offNut(p.nutriments), porzione: num(p.serving_quantity, 0), porzioneTxt: p.serving_size || '' };
    });
  }

  /* ---------- stato ---------- */
  var S = { photo: null, thumb: null, busy: false, ctrl: null, cur: null, day: dayStr(), stream: null, scanTimer: null, zx: null };

  /* ---------- navigazione ---------- */
  var ROUTES = ['home', 'risultato', 'diario', 'barcode', 'impostazioni'];
  function route() {
    var r = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    if (ROUTES.indexOf(r) < 0) r = 'home';
    if (r === 'risultato' && !S.cur) r = 'home';
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + r); });
    var navKey = r === 'risultato' ? 'home' : r;
    $$('.nav a').forEach(function (a) { if (a.getAttribute('data-nav') === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (r !== 'barcode') stopScan();
    clearAlerts();
    if (r === 'home') renderHome();
    if (r === 'diario') renderDiary();
    if (r === 'impostazioni') renderSettings();
    if (r === 'risultato') renderResult();
    window.scrollTo(0, 0);
    var m = $('#main'); if (m && document.activeElement === document.body) { /* niente focus forzato */ }
  }
  function go(r) { if (location.hash === '#/' + r) route(); else location.hash = '#/' + r; }

  /* ---------- HOME ---------- */
  function renderHome() {
    var prov = hasProvider(), step = !prov ? 1 : (S.photo ? 2 : 2);
    var loading = S.busy;
    $('#step-key').hidden = prov || loading;
    $('#step-photo').hidden = !prov || !!S.photo || loading;
    $('#step-preview').hidden = !prov || !S.photo || loading;
    $('#step-loading').hidden = !loading;
    $$('#steps li').forEach(function (li) {
      var n = +li.getAttribute('data-s'); li.classList.remove('now', 'done');
      if (n < step) { li.classList.add('done'); li.querySelector('b').textContent = '✓'; } else { li.querySelector('b').textContent = String(n); if (n === step) li.classList.add('now'); }
    });
    if (S.photo) $('#preview').src = S.photo.dataUrl;
  }
  function onPhoto(file) {
    if (!file) return;
    if (file.type && file.type.indexOf('image/') !== 0) { showAlert({ type: 'err', title: 'Non è una foto', text: 'Scegli un file immagine (JPG, PNG…).' }); return; }
    clearAlerts();
    loadBitmap(file).then(function (bm) {
      S.photo = { dataUrl: toJpeg(bm, 1024, 0.8), thumb: toJpeg(bm, 200, 0.6) };
      if (bm.close) bm.close();
      $('#in-hint').value = '';
      renderHome();
    }).catch(function (e) {
      showAlert({ type: 'err', title: e.title || 'Foto non leggibile', text: e.text || 'Prova con un’altra foto.' });
    });
  }
  function startAnalysis() {
    if (S.busy || !S.photo) return;
    S.busy = true; S.ctrl = new AbortController();
    var sig = S.ctrl.signal; sig.timedOut = false;
    var to = setTimeout(function () { sig.timedOut = true; S.ctrl.abort(); }, 60000);
    $('#loading-txt').textContent = 'Di solito servono 5–15 secondi. Non chiudere la pagina.';
    clearAlerts(); renderHome();
    var hint = $('#in-hint').value.trim();
    analyze(S.photo.dataUrl, hint, sig).then(function (r) {
      S.cur = { id: null, ts: Date.now(), thumb: S.photo.thumb, foods: r.foods, note: r.note, aff: r.aff, source: 'foto', tipo: defaultTipo(), title: '' };
      S.cur.date = dayStr(new Date(S.cur.ts));
      go('risultato');
    }).catch(function (e) {
      if (e.code === 'ABORT') { showAlert({ type: 'warn', title: 'Analisi annullata', text: 'Puoi riprovare quando vuoi.' }); return; }
      var acts = [];
      if (e.retry) acts.push({ label: '🔁 Riprova', fn: startAnalysis });
      if (e.code === 'KEY' || e.code === 'MODEL' || e.code === 'NOKEY') acts.push({ label: '⚙️ Apri impostazioni', fn: function () { go('impostazioni'); } });
      if (e.code === 'NOFOOD' || e.code === 'SAFETY') acts.push({ label: '📷 Nuova foto', fn: resetPhoto });
      showAlert({ type: 'err', title: e.title || 'Qualcosa è andato storto', text: e.text || (e.message || ''), actions: acts });
    }).then(function () { clearTimeout(to); S.busy = false; S.ctrl = null; if (location.hash.indexOf('risultato') < 0) renderHome(); });
  }
  function resetPhoto() { S.photo = null; $('#in-cam').value = ''; $('#in-gal').value = ''; renderHome(); }
  function defaultTipo() { var h = new Date().getHours(); return h < 10 ? 'colazione' : h < 15 ? 'pranzo' : h < 18 ? 'spuntino' : 'cena'; }

  /* ---------- RISULTATO ---------- */
  function renderResult() {
    var m = S.cur; if (!m) return;
    var th = $('#res-thumb'); if (m.thumb) { th.src = m.thumb; th.hidden = false; } else th.hidden = true;
    $('#r-title').value = m.title || ''; $('#r-type').value = m.tipo || 'pranzo';
    $('#btn-delete').hidden = !m.id;
    $('#btn-save').textContent = m.id ? '💾 Salva le modifiche' : '💾 Salva nel diario';
    $('#r-note').textContent = m.note || '';
    var a = $('#r-aff'); a.textContent = m.source === 'barcode' ? 'dati del prodotto' : m.aff; a.className = 'badge ' + (m.aff === 'alta' || m.source === 'barcode' ? '' : m.aff);
    renderFoods(); updateTotals();
  }
  function updateTotals() {
    var t = totals(S.cur.foods);
    $('#r-kcal').textContent = f0(t.kcal); $('#r-prot').textContent = f1(t.proteine_g); $('#r-carb').textContent = f1(t.carboidrati_g);
    $('#r-fat').textContent = f1(t.grassi_g); $('#r-fib').textContent = f1(t.fibra_g);
    var w = S.cur.foods.reduce(function (s, f) { return s + f.peso_g; }, 0);
    $('#r-sub').textContent = 'Totale per circa ' + f0(w) + ' g di cibo (stima)';
  }
  function foodVals(f) { return f0(f.kcal) + ' kcal · P ' + f1(f.proteine_g) + ' · C ' + f1(f.carboidrati_g) + ' · G ' + f1(f.grassi_g) + ' · F ' + f1(f.fibra_g); }
  function renderFoods() {
    var box = $('#foods'); box.innerHTML = '';
    S.cur.foods.forEach(function (f, i) {
      var d = document.createElement('div'); d.className = 'food'; d.setAttribute('data-i', i);
      d.innerHTML = '<div class="fn">' + esc(f.nome) + (f.fonte && f.fonte !== 'AI' ? ' <span class="badge">' + esc(f.fonte) + '</span>' : '') + '</div>' +
        '<div class="stepper"><button type="button" data-a="minus" aria-label="Meno grammi di ' + esc(f.nome) + '">−</button>' +
        '<input type="number" inputmode="decimal" min="0" max="5000" step="5" value="' + esc(Math.round(f.peso_g * 10) / 10) + '" aria-label="Grammi di ' + esc(f.nome) + '"><span class="u">g</span>' +
        '<button type="button" data-a="plus" aria-label="Più grammi di ' + esc(f.nome) + '">+</button></div>' +
        '<div class="fv" data-v>' + foodVals(f) + '</div>' +
        '<div class="row" style="margin-top:.4rem"><button type="button" class="btn ghost inline" data-a="off">🔎 Confronta con Open Food Facts</button><button type="button" class="btn ghost inline" data-a="del" aria-label="Togli ' + esc(f.nome) + '">🗑️ Togli</button></div>' +
        '<div data-off></div>';
      box.appendChild(d);
    });
    if (!S.cur.foods.length) box.innerHTML = '<p class="empty">Nessun alimento. Aggiungine uno qui sotto.</p>';
  }
  function setWeight(i, g, rerender) {
    var f = S.cur.foods[i]; if (!f) return;
    f.peso_g = Math.max(0, Math.min(5000, g)); recalcFood(f);
    if (rerender) renderFoods(); else { var el = $('#foods .food[data-i="' + i + '"] [data-v]'); if (el) el.textContent = foodVals(f); }
    updateTotals();
  }
  function offPanel(host, query, onPick, label) {
    host.innerHTML = '<div class="off">Cerco “' + esc(query) + '”…</div>';
    offSearch(query).then(function (list) {
      if (!list.length) { host.innerHTML = '<div class="off">Nessun risultato per “' + esc(query) + '”. Prova con un nome più semplice (es. “pasta”).</div>'; return; }
      host.innerHTML = '<div class="off"><strong>Scegli il più simile (valori per 100 g):</strong></div>';
      list.forEach(function (p) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'meal';
        b.innerHTML = '<span class="ph" aria-hidden="true">🏷️</span><span><span class="mt">' + esc(p.nome) + '</span><br><span class="ms">' + esc(p.marca) + ' · ' + f0(p.per100.kcal) + ' kcal · P ' + f1(p.per100.proteine_g) + ' · C ' + f1(p.per100.carboidrati_g) + ' · G ' + f1(p.per100.grassi_g) + '</span></span>';
        b.onclick = function () { onPick(p); host.innerHTML = ''; };
        host.appendChild(b);
      });
    }).catch(function (e) { host.innerHTML = '<div class="off">❌ ' + esc(e.title + '. ' + e.text) + '</div>'; });
  }
  function per100Base(p) { var b = { peso: 100 }; NUT.forEach(function (n) { b[n] = p.per100[n]; }); return b; }
  function newTipoDefaults() { return { id: null, ts: Date.now(), thumb: null, foods: [], note: '', aff: 'media', source: 'manuale', tipo: defaultTipo(), title: '' }; }

  /* ---------- salvataggio ---------- */
  function saveMeal() {
    var m = S.cur; if (!m) return;
    if (!m.foods.length) { showAlert({ type: 'warn', title: 'Il pasto è vuoto', text: 'Aggiungi almeno un alimento prima di salvare.' }); return; }
    m.title = $('#r-title').value.trim() || m.foods[0].nome; m.tipo = $('#r-type').value;
    m.totale = totals(m.foods); m.date = m.date || dayStr(new Date(m.ts));
    var rec = JSON.parse(JSON.stringify(m)); if (!rec.id) delete rec.id;
    DB.put(rec).then(function (id) {
      S.day = rec.date; S.cur = null; S.photo = null; $('#in-cam').value = ''; $('#in-gal').value = '';
      go('diario'); toast('Pasto salvato nel diario ✔');
      if (DB.isMem()) showAlert({ type: 'warn', title: 'Salvataggio temporaneo', text: 'Il browser non permette di salvare in modo permanente (modalità privata?). Il diario si cancellerà alla chiusura: usa “Esporta” per tenerne una copia.' });
    }).catch(function () { showAlert({ type: 'err', title: 'Non sono riuscito a salvare', text: 'La memoria del dispositivo potrebbe essere piena. Esporta il diario e libera spazio.' }); });
  }

  /* ---------- DIARIO ---------- */
  function renderDiary() {
    $('#d-date').value = S.day;
    var g = getGoals();
    var gf = $('#goals-form');
    if (!gf.children.length) {
      NUT.forEach(function (n) { var w = document.createElement('div'); w.innerHTML = '<label for="g-' + n + '">' + NUT_LABEL[n] + ' (' + NUT_UNIT[n] + ')</label><input id="g-' + n + '" type="number" inputmode="decimal" min="0" max="20000">'; gf.appendChild(w); });
    }
    NUT.forEach(function (n) { $('#g-' + n).value = g[n]; });
    DB.byDate(S.day).then(function (list) {
      var all = list.reduce(function (a, m) { return a.concat(m.foods); }, []);
      var t = totals(all);
      var isToday = S.day === dayStr();
      var h = '<h3 style="margin-bottom:.2rem">' + (isToday ? 'Oggi' : new Date(S.day + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })) + '</h3>';
      NUT.forEach(function (n) {
        var pct = g[n] > 0 ? Math.min(100, t[n] / g[n] * 100) : 0, over = g[n] > 0 && t[n] > g[n] * 1.0 && n !== 'fibra_g' && n !== 'proteine_g';
        h += '<div class="bar" style="--c:' + NUT_COLOR[n] + '"><div class="lab"><span>' + NUT_LABEL[n] + '</span><span>' + (n === 'kcal' ? f0(t[n]) : f1(t[n])) + ' / ' + f0(g[n]) + ' ' + NUT_UNIT[n] + '</span></div><div class="track" role="progressbar" aria-label="' + NUT_LABEL[n] + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><div class="fill' + (over ? ' over' : '') + '" style="width:' + pct + '%"></div></div></div>';
      });
      if (g.kcal > 0) { var left = g.kcal - t.kcal; h += '<p class="muted small" style="margin-bottom:0">' + (left >= 0 ? 'Ti restano circa ' + f0(left) + ' kcal per oggi.' : 'Hai superato l’obiettivo di circa ' + f0(-left) + ' kcal.') + '</p>'; }
      $('#d-summary').innerHTML = h;
      var box = $('#d-meals'); box.innerHTML = '';
      if (!list.length) { box.innerHTML = '<div class="empty"><div class="big" aria-hidden="true">🍽️</div><p><strong>Nessun pasto in questo giorno.</strong></p><p>Fotografa un piatto per iniziare.</p></div>'; return; }
      list.forEach(function (m) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'meal';
        var tt = m.totale || totals(m.foods), hh = new Date(m.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        b.innerHTML = (m.thumb ? '<img src="' + esc(m.thumb) + '" alt="">' : '<span class="ph" aria-hidden="true">' + (m.source === 'barcode' ? '🏷️' : TIPI[m.tipo] || '🍽️') + '</span>') +
          '<span><span class="mt">' + esc(m.title || 'Pasto') + '</span><br><span class="ms">' + (TIPI[m.tipo] || '') + ' ' + esc(m.tipo || '') + ' · ' + hh + '</span><br><span class="mk">' + f0(tt.kcal) + ' kcal</span> <span class="ms">· P ' + f0(tt.proteine_g) + ' C ' + f0(tt.carboidrati_g) + ' G ' + f0(tt.grassi_g) + '</span></span>';
        b.onclick = function () { S.cur = JSON.parse(JSON.stringify(m)); go('risultato'); };
        box.appendChild(b);
      });
    });
  }

  /* ---------- BARCODE ---------- */
  function setBc(t) { $('#bc-status').textContent = t || ''; }
  function stopScan() {
    if (S.scanTimer) { clearTimeout(S.scanTimer); S.scanTimer = null; }
    if (S.zx) { try { S.zx.reset(); } catch (e) { /* */ } S.zx = null; }
    if (S.stream) { S.stream.getTracks().forEach(function (t) { t.stop(); }); S.stream = null; }
    var v = $('#bc-video'); if (v) { v.srcObject = null; v.classList.remove('on'); }
    $('#bc-start').hidden = false; $('#bc-stop').hidden = true;
  }
  function loadZXing() {
    if (window.ZXing) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = function () { rej(new Error('zxing')); }; document.head.appendChild(s);
    });
  }
  function startScan() {
    clearAlerts();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setBc('Questo browser non può usare la fotocamera qui. Scrivi il numero del codice a barre nel riquadro sotto.'); return; }
    setBc('Avvio la fotocamera…');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (stream) {
      S.stream = stream; var v = $('#bc-video'); v.srcObject = stream; v.classList.add('on');
      $('#bc-start').hidden = true; $('#bc-stop').hidden = false;
      return v.play().catch(function () { /* autoplay */ }).then(function () {
        setBc('Inquadra il codice a barre e tieni fermo il telefono.');
        if ('BarcodeDetector' in window) {
          var det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          (function tick() {
            if (!S.stream) return;
            det.detect(v).then(function (r) { if (r && r[0] && r[0].rawValue) { onCode(r[0].rawValue); } else S.scanTimer = setTimeout(tick, 250); }).catch(function () { S.scanTimer = setTimeout(tick, 400); });
          })();
        } else {
          setBc('Carico lo scanner… (serve internet)');
          return loadZXing().then(function () {
            if (!S.stream) return;
            var Z = window.ZXing, hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
            S.zx = new Z.BrowserMultiFormatReader(hints, 300);
            setBc('Inquadra il codice a barre e tieni fermo il telefono.');
            S.zx.decodeFromStream(stream, v, function (res) { if (res && S.stream) onCode(res.getText()); });
          }).catch(function () { setBc('Lo scanner automatico non è disponibile. Scrivi il numero sotto il codice a barre nel riquadro qui sotto.'); });
        }
      });
    }).catch(function (e) {
      stopScan(); setBc('');
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      showAlert({ type: 'warn', title: denied ? 'Fotocamera non autorizzata' : 'Fotocamera non disponibile', text: denied ? 'Hai negato l’accesso alla fotocamera. Puoi consentirlo dalle impostazioni del browser, oppure scrivere il numero del codice a barre qui sotto.' : 'Non trovo una fotocamera utilizzabile. Scrivi il numero del codice a barre qui sotto.' });
    });
  }
  function onCode(code) { stopScan(); if (navigator.vibrate) navigator.vibrate(60); $('#bc-manual').value = code; setBc('Codice letto: ' + code); lookupCode(code); }
  function validEan(c) { return /^\d{8}$|^\d{12,14}$/.test(c); }
  function lookupCode(code) {
    code = String(code || '').replace(/\D/g, ''); var box = $('#bc-result'); clearAlerts();
    if (!validEan(code)) { showAlert({ type: 'warn', title: 'Numero non valido', text: 'Il codice deve avere 8, 12 o 13 cifre (sono i numeri stampati sotto le barre).' }); return; }
    box.hidden = false; box.innerHTML = '<div class="center"><div class="spinner" role="status" aria-label="Ricerca"></div><p>Cerco il prodotto…</p></div>';
    offProduct(code).then(function (p) {
      if (!p) { box.innerHTML = '<h3>Prodotto non trovato</h3><p>Il codice <strong>' + esc(code) + '</strong> non è nel database Open Food Facts. Puoi <a href="#/home">fotografare il piatto</a> oppure ricontrollare il numero.</p>'; return; }
      if (!p.per100) { box.innerHTML = '<h3>' + esc(p.nome) + '</h3><p>Questo prodotto non ha i valori nutrizionali nel database. Prova a <a href="#/home">fotografarlo</a>.</p>'; return; }
      var gdef = p.porzione || 100, q = p.per100;
      box.innerHTML = '<h3>' + esc(p.nome) + '</h3><p class="muted">' + esc(p.marca) + '</p>' +
        '<p><strong>Per 100 g:</strong> ' + f0(q.kcal) + ' kcal · Proteine ' + f1(q.proteine_g) + ' g · Carboidrati ' + f1(q.carboidrati_g) + ' g · Grassi ' + f1(q.grassi_g) + ' g · Fibre ' + f1(q.fibra_g) + ' g</p>' +
        '<label for="bc-g">Quanti grammi ne mangi?' + (p.porzioneTxt ? ' (porzione indicata: ' + esc(p.porzioneTxt) + ')' : '') + '</label>' +
        '<div class="stepper"><button type="button" data-a="m" aria-label="Meno grammi">−</button><input id="bc-g" type="number" inputmode="decimal" min="1" max="5000" step="5" value="' + gdef + '"><span class="u">g</span><button type="button" data-a="p" aria-label="Più grammi">+</button></div>' +
        '<button class="btn big" type="button" id="bc-add" style="margin-top:.8rem">Aggiungi al pasto ➜</button>';
      var inp = $('#bc-g', box);
      box.onclick = function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (a) inp.value = Math.max(1, num(inp.value, 100) + (a === 'p' ? 10 : -10)); };
      $('#bc-add', box).onclick = function () {
        var g = num(inp.value, 0); if (g <= 0) { showAlert({ type: 'warn', title: 'Indica i grammi', text: 'Scrivi quanti grammi del prodotto mangi.' }); return; }
        var f = mkFood({ nome: p.nome + (p.marca ? ' (' + p.marca.split(',')[0] + ')' : ''), peso_g: g, b: per100Base(p), fonte: 'Open Food Facts' }, true);
        S.cur = newTipoDefaults(); S.cur.source = 'barcode'; S.cur.aff = 'alta'; S.cur.foods = [f]; S.cur.date = dayStr(new Date(S.cur.ts));
        go('risultato');
      };
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function (e) { box.hidden = true; showAlert({ type: 'err', title: e.title, text: e.text, actions: [{ label: '🔁 Riprova', fn: function () { lookupCode(code); } }] }); });
  }

  /* ---------- IMPOSTAZIONI ---------- */
  function renderSettings() {
    var s = getSettings();
    $('#s-theme').value = s.theme || 'auto'; $('#s-size').value = String(s.size || '1');
    $('#s-key').value = s.gemKey || ''; $('#s-model').value = s.gemModel || 'gemini-2.5-flash';
    $('#s-keystate').textContent = s.gemKey ? '✅ Chiave salvata su questo dispositivo.' : 'Nessuna chiave Gemini salvata.';
    var a = s.alt; $('#a-preset').value = a.preset || 'openrouter'; $('#a-base').value = a.base || ''; $('#a-model').value = a.model || ''; $('#a-key').value = a.key || '';
    $('#p-url').value = s.proxy || '';
    $('#ver').textContent = VERSION;
  }
  function verifyGemini(key) {
    return fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, cache: 'no-store' }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) return 'bad';
      return r.ok ? 'ok' : 'unknown';
    }).catch(function () { return 'unknown'; });
  }
  function saveKey(inputEl, after) {
    var key = inputEl.value.trim().replace(/\s+/g, '');
    if (!key) { showAlert({ type: 'warn', title: 'Manca la chiave', text: 'Incolla la chiave nel campo, poi tocca di nuovo il pulsante.' }); return; }
    if (key.length < 20) { showAlert({ type: 'warn', title: 'La chiave sembra incompleta', text: 'Di solito è lunga circa 39 caratteri e inizia con “AIza”. Riprova a copiarla per intero.' }); return; }
    var btn = after.btn; var old = btn.textContent; btn.disabled = true; btn.textContent = 'Controllo la chiave…';
    verifyGemini(key).then(function (r) {
      btn.disabled = false; btn.textContent = old;
      if (r === 'bad') { showAlert({ type: 'err', title: 'Chiave non valida', text: 'Google non riconosce questa chiave. Controlla di averla copiata tutta, oppure creane una nuova su aistudio.google.com.' }); return; }
      var s = getSettings(); s.gemKey = key; saveSettings(s); inputEl.value = '';
      after.done(r === 'unknown');
    });
  }

  function exportData() {
    DB.all().then(function (meals) {
      var s = getSettings();
      var out = { app: 'NutriPWA', version: 1, exportedAt: new Date().toISOString(), goals: getGoals(), settings: { theme: s.theme || 'auto', size: s.size || '1', gemModel: s.gemModel || '' }, meals: meals };
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nutripwa-' + dayStr() + '.json';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('Esportazione creata ✔ (' + meals.length + ' pasti)');
    });
  }
  function importData(file) {
    if (!file) return;
    var r = new FileReader();
    r.onerror = function () { showAlert({ type: 'err', title: 'File non leggibile', text: 'Non riesco ad aprire il file.' }); };
    r.onload = function () {
      var d; try { d = JSON.parse(r.result); } catch (e) { showAlert({ type: 'err', title: 'File non valido', text: 'Il file non è un’esportazione di NutriPWA (JSON non leggibile).' }); return; }
      if (!d || d.app !== 'NutriPWA' || !Array.isArray(d.meals)) { showAlert({ type: 'err', title: 'File non valido', text: 'Questo file non sembra un’esportazione di NutriPWA.' }); return; }
      DB.all().then(function (have) {
        var seen = {}; have.forEach(function (m) { seen[m.ts] = 1; });
        var add = d.meals.filter(function (m) { return m && m.ts && Array.isArray(m.foods) && !seen[m.ts]; });
        return add.reduce(function (p, m) { delete m.id; m.foods = m.foods.map(function (f) { f.b = f.b || { peso: f.peso_g || 100, kcal: f.kcal, proteine_g: f.proteine_g, carboidrati_g: f.carboidrati_g, grassi_g: f.grassi_g, fibra_g: f.fibra_g }; return f; }); m.date = m.date || dayStr(new Date(m.ts)); return p.then(function () { return DB.put(m); }); }, Promise.resolve()).then(function () {
          if (d.goals) LS.set('nutri.goals', Object.assign({}, DEFAULT_GOALS, d.goals));
          showAlert({ type: 'ok', title: 'Importazione completata', text: 'Aggiunti ' + add.length + ' pasti' + (d.meals.length - add.length ? ' (' + (d.meals.length - add.length) + ' erano già presenti).' : '.') });
        });
      }).catch(function () { showAlert({ type: 'err', title: 'Importazione non riuscita', text: 'Memoria piena o dati non validi.' }); });
    };
    r.readAsText(file);
  }

  /* ---------- eventi ---------- */
  function bind() {
    $('#in-cam').onchange = $('#in-gal').onchange = function (e) { onPhoto(e.target.files[0]); };
    $('#btn-analyze').onclick = startAnalysis;
    $('#btn-change').onclick = resetPhoto;
    $('#btn-cancel').onclick = function () { if (S.ctrl) S.ctrl.abort(); };
    $('#btn-showkey').onclick = function () { var i = $('#in-key'); i.type = i.type === 'password' ? 'text' : 'password'; };
    $('#btn-savekey').onclick = function () { saveKey($('#in-key'), { btn: $('#btn-savekey'), done: function (unk) { toast('Chiave salvata ✔'); if (unk) showAlert({ type: 'warn', title: 'Chiave salvata, ma non verificata', text: 'Non sono riuscito a controllarla (connessione?). Funzionerà se è corretta.' }); renderHome(); } }); };
    $('#btn-theme').onclick = function () {
      var s = getSettings(), r = document.documentElement.getAttribute('data-theme');
      var dark = r === 'dark' || (r === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      s.theme = dark ? 'light' : 'dark'; saveSettings(s); applyTheme();
    };
    // risultato
    $('#foods').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var d = b.closest('.food'), i = +d.getAttribute('data-i'), f = S.cur.foods[i], a = b.getAttribute('data-a');
      if (a === 'minus' || a === 'plus') { var step = f.peso_g >= 100 ? 10 : 5; setWeight(i, f.peso_g + (a === 'plus' ? step : -step), true); }
      if (a === 'del') { S.cur.foods.splice(i, 1); renderFoods(); updateTotals(); }
      if (a === 'off') offPanel($('[data-off]', d), f.nome, function (p) { f.b = per100Base(p); f.fonte = 'Open Food Facts'; recalcFood(f); renderFoods(); updateTotals(); toast('Valori aggiornati da Open Food Facts'); });
    });
    $('#foods').addEventListener('input', function (e) { if (e.target.type !== 'number') return; var i = +e.target.closest('.food').getAttribute('data-i'); setWeight(i, num(e.target.value, 0), false); });
    $('#foods').addEventListener('change', function (e) { if (e.target.type !== 'number') return; var i = +e.target.closest('.food').getAttribute('data-i'); setWeight(i, num(e.target.value, 0), true); });
    $('#btn-addfood').onclick = function () {
      var host = $('#foods'), ex = $('#addfood-form'); if (ex) { ex.remove(); return; }
      var d = document.createElement('div'); d.id = 'addfood-form'; d.className = 'food';
      d.innerHTML = '<label for="af-q" style="margin-top:0">Che alimento vuoi aggiungere?</label><div class="keyrow"><input id="af-q" type="text" maxlength="60" placeholder="Es. pane, olio d’oliva, mela"><button class="btn inline" type="button" id="af-go">Cerca</button></div><div id="af-res"></div>';
      host.appendChild(d); $('#af-q').focus();
      function go1() { var q = $('#af-q').value.trim(); if (!q) return; offPanel($('#af-res'), q, function (p) { S.cur.foods.push(mkFood({ nome: p.nome, peso_g: 100, b: per100Base(p), fonte: 'Open Food Facts' }, true)); renderFoods(); updateTotals(); }); }
      $('#af-go').onclick = go1; $('#af-q').onkeydown = function (e) { if (e.key === 'Enter') go1(); };
    };
    $('#btn-save').onclick = saveMeal;
    $('#btn-new').onclick = function () { S.cur = null; resetPhoto(); go('home'); };
    $('#btn-delete').onclick = function () {
      ask('Vuoi davvero eliminare questo pasto dal diario?', 'Sì, elimina').then(function (ok) { if (!ok) return; DB.del(S.cur.id).then(function () { S.cur = null; go('diario'); toast('Pasto eliminato'); }); });
    };
    // diario
    $('#d-prev').onclick = function () { S.day = addDays(S.day, -1); renderDiary(); };
    $('#d-next').onclick = function () { S.day = addDays(S.day, 1); renderDiary(); };
    $('#d-date').onchange = function (e) { if (e.target.value) { S.day = e.target.value; renderDiary(); } };
    $('#btn-savegoals').onclick = function () {
      var g = {}; NUT.forEach(function (n) { g[n] = num($('#g-' + n).value, DEFAULT_GOALS[n]); });
      LS.set('nutri.goals', g); renderDiary(); toast('Obiettivi salvati ✔');
    };
    // barcode
    $('#bc-start').onclick = startScan; $('#bc-stop').onclick = function () { stopScan(); setBc(''); };
    $('#bc-search').onclick = function () { lookupCode($('#bc-manual').value); };
    $('#bc-manual').onkeydown = function (e) { if (e.key === 'Enter') lookupCode(e.target.value); };
    // impostazioni
    $('#s-theme').onchange = $('#s-size').onchange = function () { var s = getSettings(); s.theme = $('#s-theme').value; s.size = $('#s-size').value; saveSettings(s); applyTheme(); };
    $('#s-savekey').onclick = function () {
      var s = getSettings(), model = $('#s-model').value.trim() || 'gemini-2.5-flash';
      if (!$('#s-key').value.trim()) { s.gemModel = model; saveSettings(s); renderSettings(); toast('Salvato ✔'); return; }
      saveKey($('#s-key'), { btn: $('#s-savekey'), done: function (unk) { var s2 = getSettings(); s2.gemModel = model; saveSettings(s2); renderSettings(); toast('Chiave salvata ✔'); if (unk) showAlert({ type: 'warn', title: 'Chiave salvata, ma non verificata', text: 'Non sono riuscito a controllarla (connessione?).' }); } });
    };
    $('#s-rmkey').onclick = function () { ask('Rimuovere la chiave Gemini da questo dispositivo?', 'Sì, rimuovi').then(function (ok) { if (!ok) return; var s = getSettings(); delete s.gemKey; saveSettings(s); renderSettings(); toast('Chiave rimossa'); }); };
    $('#a-preset').onchange = function () { var p = PRESETS[$('#a-preset').value]; if (p && $('#a-preset').value !== 'custom') { $('#a-base').value = p.base; $('#a-model').value = p.model; } };
    $('#a-save').onclick = function () {
      var base = $('#a-base').value.trim(), model = $('#a-model').value.trim(), key = $('#a-key').value.trim();
      if (key && (!/^https:\/\//i.test(base) || !model)) { showAlert({ type: 'warn', title: 'Dati incompleti', text: 'Indica un indirizzo che inizia con https:// e il nome del modello.' }); return; }
      var s = getSettings(); s.alt = { preset: $('#a-preset').value, base: base, model: model, key: key }; saveSettings(s); toast('Provider salvato ✔');
    };
    $('#a-rm').onclick = function () { var s = getSettings(); s.alt.key = ''; saveSettings(s); renderSettings(); toast('Chiave del provider rimossa'); };
    $('#p-save').onclick = function () {
      var u = $('#p-url').value.trim();
      if (u && !/^https:\/\//i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(u)) { showAlert({ type: 'warn', title: 'Indirizzo non valido', text: 'Deve iniziare con https://' }); return; }
      var s = getSettings(); if (u) s.proxy = u; else delete s.proxy; saveSettings(s); toast(u ? 'Proxy salvato ✔' : 'Proxy rimosso');
    };
    $('#x-export').onclick = exportData;
    $('#x-import').onchange = function (e) { importData(e.target.files[0]); e.target.value = ''; };
    $('#x-wipe').onclick = function () {
      ask('Cancellare TUTTI i pasti, gli obiettivi e le chiavi salvate su questo dispositivo? Non si può annullare.', 'Sì, cancella tutto').then(function (ok) {
        if (!ok) return; DB.clear().then(function () { ['nutri.settings', 'nutri.goals'].forEach(LS.del); S.cur = null; S.photo = null; applyTheme(); renderSettings(); toast('Dati cancellati'); });
      });
    };
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEv = e; $('#btn-install').hidden = false; });
    $('#btn-install').onclick = function () { if (!S.installEv) return; S.installEv.prompt(); S.installEv = null; $('#btn-install').hidden = true; };
    window.addEventListener('appinstalled', function () { $('#btn-install').hidden = true; toast('App installata ✔'); });
    window.addEventListener('hashchange', route);
    window.addEventListener('offline', function () { showAlert({ type: 'warn', title: 'Sei offline', text: 'Puoi consultare il diario, ma per analizzare foto serve internet.' }); });
    window.addEventListener('online', function () { toast('Di nuovo online'); });
  }

  /* ---------- avvio ---------- */
  function init() {
    applyTheme(); bind(); $('#ver').textContent = VERSION;
    if (location.hash === '' || location.hash === '#') history.replaceState(null, '', '#/home');
    route();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* l'app funziona anche senza */ }); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
