"""Test end-to-end locale di NutriPWA (Playwright + Chrome headless, rete AI simulata).
Uso: python3 -m http.server 8765 &  poi  python3 tests/e2e.py"""
import json, sys, os, re
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8765/')
OUT = os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
PHOTO = os.path.join(os.path.dirname(__file__), 'plate.jpg')
errors = []; fails = []; gem_reqs = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + str(extra) if extra and not cond else ''))
    if not cond: fails.append(name)
AI = {"alimenti":[{"nome":"Pasta al pomodoro","peso_g":200,"kcal":320,"proteine_g":11,"carboidrati_g":60,"grassi_g":5,"fibra_g":4},{"nome":"Parmigiano","peso_g":10,"kcal":40,"proteine_g":3.5,"carboidrati_g":0,"grassi_g":2.8,"fibra_g":0}],"totale":{"kcal":360},"note":"Porzione stimata dal piatto.","affidabilita":"media"}
mode = {'gemini': 'ok'}
def gem(route):
    req = route.request
    if req.method == 'GET':  # verifica chiave
        return route.fulfill(status=200, content_type='application/json', body='{"models":[]}')
    gem_reqs.append((req.url, dict(req.headers), req.post_data))
    if mode['gemini'] == '429':
        return route.fulfill(status=429, content_type='application/json', body='{"error":{"message":"quota"}}')
    route.fulfill(status=200, content_type='application/json', body=json.dumps({"candidates":[{"content":{"parts":[{"text":json.dumps(AI)}]}}]}))
def alt(route):
    route.fulfill(status=200, content_type='application/json', body=json.dumps({"choices":[{"message":{"content":"```json\n"+json.dumps(AI)+"\n```"}}]}))
def off(route):
    u = route.request.url
    if 'api/v2/product/8076800195057' in u:
        body = {"status":1,"product":{"product_name":"Spaghetti n.5","brands":"Barilla","serving_quantity":80,"serving_size":"80 g","nutriments":{"energy-kcal_100g":359,"proteins_100g":13,"carbohydrates_100g":71,"fat_100g":2,"fiber_100g":3}}}
    elif 'api/v2/product/' in u: body = {"status":0}
    else: body = {"products":[{"code":"1","product_name":"Pane comune","brands":"X","nutriments":{"energy-kcal_100g":265,"proteins_100g":9,"carbohydrates_100g":49,"fat_100g":3.2,"fiber_100g":2.7}}]}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    ctx = b.new_context(viewport={'width':375,'height':760}, device_scale_factor=2, locale='it-IT', accept_downloads=True, permissions=['camera'])
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.route('https://generativelanguage.googleapis.com/**', gem)
    pg.route('https://openrouter.ai/**', alt)
    pg.route('https://world.openfoodfacts.org/**', off)
    pg.on('dialog', lambda d: errors.append('DIALOG ' + d.message))
    pg.goto(BASE); pg.wait_for_load_state('networkidle')
    check('titolo', 'NutriPWA' in pg.title())
    check('step1 visibile', pg.locator('#step-key').is_visible())
    check('footer P.IVA', '05770260288' in pg.locator('#footer').inner_text())
    pg.screenshot(path=f'{OUT}/01-chiave.png', full_page=True)
    # chiave troppo corta
    pg.fill('#in-key', 'abc'); pg.click('#btn-savekey'); check('chiave corta -> avviso', pg.locator('#alerts .alert').count() == 1)
    pg.fill('#in-key', 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345'); pg.click('#btn-savekey')
    pg.wait_for_selector('#step-photo:not([hidden])')
    check('chiave salvata in localStorage', 'AIzaSyFAKE' in pg.evaluate("localStorage.getItem('nutri.settings')"))
    pg.screenshot(path=f'{OUT}/02-foto.png', full_page=True)
    pg.set_input_files('#in-gal', PHOTO); pg.wait_for_selector('#step-preview:not([hidden])')
    sz = pg.evaluate("document.getElementById('preview').src.length")
    check('foto compressa (<400KB dataurl)', sz < 400000, sz)
    pg.fill('#in-hint', 'pasta al pomodoro')
    pg.screenshot(path=f'{OUT}/03-anteprima.png', full_page=True)
    pg.click('#btn-analyze'); pg.wait_for_selector('#page-risultato.active')
    check('chiamata Gemini con header x-goog-api-key', len(gem_reqs) == 1 and gem_reqs[0][1].get('x-goog-api-key','').startswith('AIza'))
    check('chiave NON in URL', 'key=' not in gem_reqs[0][0] and 'AIza' not in gem_reqs[0][0])
    check('modello 2.5-flash', 'gemini-2.5-flash:generateContent' in gem_reqs[0][0])
    check('hint nel prompt', 'pasta al pomodoro' in gem_reqs[0][2])
    check('totale kcal 360', pg.inner_text('#r-kcal') == '360', pg.inner_text('#r-kcal'))
    check('2 alimenti', pg.locator('#foods .food').count() == 2)
    pg.screenshot(path=f'{OUT}/04-risultato.png', full_page=True)
    pg.click('#foods .food:first-child button[data-a=plus]')
    w = pg.input_value('#foods .food:first-child input'); check('peso +10 => 210', w == '210', w)
    check('kcal ricalcolate (=> 376)', pg.inner_text('#r-kcal') == '376', pg.inner_text('#r-kcal'))
    pg.fill('#foods .food:first-child input', '100'); pg.dispatch_event('#foods .food:first-child input', 'change')
    check('kcal a 100g => 200', pg.inner_text('#r-kcal') == '200', pg.inner_text('#r-kcal'))
    # OFF per food
    pg.click('#foods .food:first-child button[data-a=off]'); pg.wait_for_selector('#foods [data-off] .meal')
    pg.click('#foods [data-off] .meal'); check('OFF sostituisce valori (100g pane=265 + 40 = 305)', pg.inner_text('#r-kcal') == '305', pg.inner_text('#r-kcal'))
    pg.fill('#r-title', 'Pranzo test'); pg.click('#btn-save'); pg.wait_for_selector('#page-diario.active')
    pg.wait_for_selector('#d-meals .meal')
    check('pasto nel diario', pg.locator('#d-meals .meal').count() == 1)
    check('thumbnail', pg.locator('#d-meals .meal img').count() == 1)
    pg.screenshot(path=f'{OUT}/05-diario.png', full_page=True)
    # obiettivi
    pg.click('#goals-box summary'); pg.fill('#g-kcal', '1800'); pg.click('#btn-savegoals')
    pg.wait_for_function("document.getElementById('d-summary').innerText.includes('1800')"); check('obiettivo salvato', True)
    # riapri pasto e modifica
    pg.click('#d-meals .meal'); pg.wait_for_selector('#page-risultato.active'); check('riapri pasto: elimina visibile', pg.locator('#btn-delete').is_visible())
    pg.click('#btn-save'); pg.wait_for_selector('#page-diario.active')
    # barcode manuale
    pg.click('.nav a[data-nav=barcode]'); pg.fill('#bc-manual', '8076800195057'); pg.click('#bc-search'); pg.wait_for_selector('#bc-add')
    check('prodotto barcode', 'Spaghetti' in pg.inner_text('#bc-result'))
    pg.screenshot(path=f'{OUT}/06-barcode.png', full_page=True)
    pg.click('#bc-add'); pg.wait_for_selector('#page-risultato.active')
    check('barcode 80g => 287 kcal', pg.inner_text('#r-kcal') == '287', pg.inner_text('#r-kcal'))
    pg.click('#btn-save'); pg.wait_for_selector('#page-diario.active'); pg.wait_for_selector('#d-meals .meal:nth-child(2)')
    pg.click('.nav a[data-nav=barcode]'); pg.fill('#bc-manual', '12345678'); pg.click('#bc-search'); pg.wait_for_selector('#bc-result:has-text("non trovato")')
    pg.fill('#bc-manual', '12'); pg.click('#bc-search'); check('EAN non valido -> avviso', pg.locator('#alerts .alert').count() == 1)
    # camera finta
    pg.click('#bc-start'); pg.wait_for_timeout(2500); pg.screenshot(path=f'{OUT}/07-scanner.png', full_page=True)
    print('INFO stato scanner:', pg.inner_text('#bc-status'))
    pg.click('.nav a[data-nav=impostazioni]')
    # export
    with pg.expect_download() as dl: pg.click('#x-export')
    path = f'{OUT}/export.json'; dl.value.save_as(path); ex = json.load(open(path))
    check('export JSON', ex['app'] == 'NutriPWA' and len(ex['meals']) == 2 and 'gemKey' not in json.dumps(ex), len(ex['meals']))
    # wipe + import
    pg.click('#x-wipe'); pg.click('dialog [data-r="1"]'); pg.wait_for_timeout(400)
    check('wipe rimuove chiave', pg.evaluate("localStorage.getItem('nutri.settings')") in (None, 'null'))
    pg.set_input_files('#x-import', path); pg.wait_for_selector('#alerts .alert.ok')
    pg.click('.nav a[data-nav=diario]'); pg.wait_for_selector('#d-meals .meal')
    check('import ripristina 2 pasti', pg.locator('#d-meals .meal').count() == 2)
    pg.set_input_files('#x-import', os.path.join(os.path.dirname(__file__), 'plate.jpg')) if False else None
    # fallback provider: niente gemini key -> alt
    pg.click('.nav a[data-nav=impostazioni]')
    pg.screenshot(path=f'{OUT}/08-impostazioni.png', full_page=True)
    pg.evaluate("localStorage.setItem('nutri.settings', JSON.stringify({gemKey:'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345', alt:{preset:'openrouter',base:'https://openrouter.ai/api/v1',model:'x/y',key:'sk-or-test-123'}}))")
    mode['gemini'] = '429'
    pg.goto(BASE + '#/home'); pg.reload(); pg.wait_for_selector('#step-photo:not([hidden])')
    pg.set_input_files('#in-cam', PHOTO); pg.wait_for_selector('#step-preview:not([hidden])'); pg.click('#btn-analyze'); pg.wait_for_selector('#page-risultato.active', timeout=15000)
    check('fallback OpenRouter dopo 429', pg.inner_text('#r-kcal') == '360')
    # solo gemini + 429 -> errore italiano
    pg.evaluate("localStorage.setItem('nutri.settings', JSON.stringify({gemKey:'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345'}))")
    pg.reload(); pg.set_input_files('#in-gal', PHOTO); pg.wait_for_selector('#step-preview:not([hidden])'); pg.click('#btn-analyze'); pg.wait_for_selector('#alerts .alert.err')
    t = pg.inner_text('#alerts'); check('errore 429 in italiano', 'Limite gratuito' in t, t)
    pg.screenshot(path=f'{OUT}/09-errore.png', full_page=True)
    # tema scuro + testo grande
    pg.evaluate("localStorage.setItem('nutri.settings', JSON.stringify({theme:'dark',size:'1.3',gemKey:'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345'}))")
    pg.goto(BASE + '#/diario'); pg.reload(); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{OUT}/10-scuro-grande.png', full_page=True)
    # overflow orizzontale
    for r in ['home','diario','barcode','impostazioni']:
        pg.goto(BASE + '#/' + r); pg.reload(); pg.wait_for_timeout(200)
        ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f'nessuno scroll orizzontale #{r}', ov <= 0, ov)
    # pagine legali + footer
    for pgname in ['privacy.html','termini.html','cookie.html']:
        pg.goto(BASE + pgname); t = pg.inner_text('footer')
        check(f'{pgname}: footer completo', all(x in t for x in ['Pi.Gi Service','Via Guido Reni 8, 35133 Padova (PD)','05770260288','info@pigiservice.com','pigiservice@pec.it','+39 352 0966114']))
        check(f'{pgname}: contatto info@', 'info@pigiservice.com' in pg.inner_text('main'))
    pg.screenshot(path=f'{OUT}/11-privacy.png', full_page=True)
    # PWA
    pg.goto(BASE); pg.wait_for_timeout(1500)
    sw = pg.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length)"); check('service worker registrato', sw == 1)
    pg.wait_for_function("navigator.serviceWorker.controller !== null || true")
    keys = pg.evaluate("caches.keys()"); check('cache versionata', keys == ['nutripwa-v1.0.0'], keys)
    cached = pg.evaluate("caches.open('nutripwa-v1.0.0').then(c=>c.keys()).then(k=>k.map(r=>new URL(r.url).pathname))")
    check('precache completo e nessuna API in cache', len(cached) >= 12 and not any('google' in c for c in cached), cached)
    m = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'manifest.webmanifest')))
    pg.reload(); pg.wait_for_timeout(800)
    ctx.set_offline(True); pg.reload(); pg.wait_for_timeout(800)
    check('offline: la shell si carica', 'NutriPWA' in pg.title() and pg.locator('#footer').count() == 1)
    ctx.set_offline(False)
    b.close()
    # installabilità: serve un profilo persistente (non incognito)
    pc = p.chromium.launch_persistent_context('/tmp/nutri-prof', executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox'])
    pp = pc.new_page(); pp.goto(BASE); pp.wait_for_timeout(2500)
    cdp = pc.new_cdp_session(pp); r = cdp.send('Page.getInstallabilityErrors'); check('installabilità (CDP) senza errori', r.get('installabilityErrors') == [], r)
    mf = cdp.send('Page.getAppManifest'); check('manifest senza errori', not mf.get('errors'), mf.get('errors'))
    pc.close()
real = [e for e in errors if 'Failed to load resource' not in e]
check('nessun errore console/JS', not real, real)
print('\nERRORI:', errors)
print('\nFALLITI:', fails if fails else 'nessuno'); sys.exit(1 if fails else 0)
