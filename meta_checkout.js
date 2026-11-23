/* ASW Marine Parts — Meta / Facebook Shop checkout helper
   Loaded by the hidden /meta-checkout page. Maps catalog ids (feed `id` / SKU,
   including numeric SKUs) to Squarespace product ids, adds them to the cart,
   then sends the shopper to /checkout.
   https://developers.facebook.com/docs/commerce-platform/setup-checkout-url
*/
(function () {
  var MAP_URLS = [
    'https://damienmueller-cloud.github.io/asw-marine-feed/meta_id_map.json',
    'https://cdn.jsdelivr.net/gh/damienmueller-cloud/asw-marine-feed@main/meta_id_map.json',
    'https://raw.githubusercontent.com/damienmueller-cloud/asw-marine-feed/main/meta_id_map.json'
  ];
  var TRACK_PREFIX = 'utm_';
  var TRACK_KEYS = { fbclid: 1, cart_origin: 1 };

  function $(id) { return document.getElementById(id); }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function params() { return new URLSearchParams(window.location.search); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeId(id) {
    return String(id == null ? '' : id).trim();
  }

  function parseProducts(raw) {
    var out = [];
    if (!raw) return out;
    String(raw).split(',').forEach(function (entry) {
      entry = String(entry).trim();
      if (!entry) return;
      var i = entry.lastIndexOf(':');
      if (i < 0) {
        out.push({ id: normalizeId(entry), qty: 0, error: 'Missing quantity' });
        return;
      }
      var id = normalizeId(entry.slice(0, i));
      var qty = parseInt(entry.slice(i + 1), 10);
      if (!id) out.push({ id: entry, qty: 0, error: 'Missing product id' });
      else if (!qty || qty < 1) out.push({ id: id, qty: 0, error: 'Invalid quantity' });
      else out.push({ id: id, qty: qty });
    });
    return out;
  }

  function readCoupon(q) {
    if (!q.has('coupon')) return '';
    var c = (q.get('coupon') == null ? '' : String(q.get('coupon'))).trim();
    if (!c || /^(undefined|null|n\/a)$/i.test(c)) return '';
    return c;
  }

  function lookupProductId(map, sku) {
    if (!map || sku == null || sku === '') return null;
    var key = normalizeId(sku);
    if (Object.prototype.hasOwnProperty.call(map, key) && map[key]) return String(map[key]);
    // Some maps may have been built with numeric keys; try both forms.
    if (Object.prototype.hasOwnProperty.call(map, sku) && map[sku]) return String(map[sku]);
    var asNum = Number(key);
    if (String(asNum) === key && map[asNum]) return String(map[asNum]);
    return null;
  }

  function trackingQuery() {
    var p = params();
    var out = new URLSearchParams();
    p.forEach(function (value, key) {
      if (key === 'products' || key === 'coupon' || key === 'clear') return;
      if (key.indexOf(TRACK_PREFIX) === 0 || TRACK_KEYS[key]) out.set(key, value);
    });
    var s = out.toString();
    return s ? ('?' + s) : '';
  }

  function mount() {
    document.documentElement.classList.add('asw-meta-checkout-active');
    var el = $('asw-meta-checkout');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'asw-meta-checkout';
    el.innerHTML = '<h1>Preparing your checkout</h1><p class="asw-status asw-muted">Adding your items...</p><div class="asw-detail"></div>';
    var host = document.querySelector('.page-section .content-wrapper, main, #page, body');
    if (host) host.insertBefore(el, host.firstChild);
    else document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function setStatus(html, className) {
    var el = mount();
    var p = el.querySelector('.asw-status');
    p.className = 'asw-status' + (className ? ' ' + className : '');
    p.innerHTML = html;
  }

  function setDetail(html) {
    mount().querySelector('.asw-detail').innerHTML = html || '';
  }

  function parseJsonSafe(text) {
    try { return text ? JSON.parse(text) : null; } catch (e) { return text; }
  }

  function uuid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Date.now()) + Math.random().toString(16).slice(2));
  }

  var memCrumb = null;
  function allCrumbs() {
    var out = [];
    if (memCrumb) out.push(memCrumb);
    document.cookie.split(/;\s*/).forEach(function (c) {
      if (c.indexOf('crumb=') === 0) {
        var v = c.slice(6), d = v;
        try { d = decodeURIComponent(v); } catch (e) {}
        [d, v].forEach(function (x) { if (x && out.indexOf(x) < 0) out.push(x); });
      }
    });
    out.push(null);
    return out;
  }

  function request(url, opts) {
    opts = opts || {};
    var crumbs = allCrumbs();
    var lastErr = null;
    function attempt(i) {
      if (i >= crumbs.length) return Promise.reject(lastErr || new Error('Request failed'));
      var headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
      if (crumbs[i] && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = crumbs[i];
      return fetch(url, {
        method: opts.method || 'GET',
        credentials: 'same-origin',
        headers: headers,
        body: opts.body
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = parseJsonSafe(text);
          if (data && data.crumb && crumbs.indexOf(data.crumb) < 0) crumbs.splice(i + 1, 0, data.crumb);
          if (res.ok && !(data && data.crumbFail)) {
            if (crumbs[i]) memCrumb = crumbs[i];
            return { ok: true, status: res.status, data: data };
          }
          lastErr = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
          lastErr.status = res.status;
          lastErr.body = data;
          if (res.status === 403 || (data && data.crumbFail)) return attempt(i + 1);
          return { ok: false, status: res.status, data: data, error: lastErr };
        });
      });
    }
    return attempt(0);
  }

  function unwrapCart(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.shoppingCart) return data.shoppingCart;
    if (data.entries || data.items || data.cartToken || data.totalQuantity != null) return data;
    return null;
  }

  function getCart() {
    return request('/api/commerce/shopping-cart').then(function (r) {
      if (r.status === 404) return { entries: [], totalQuantity: 0, cartToken: null, empty: true };
      if (!r.ok) throw r.error || new Error('Could not read cart');
      return unwrapCart(r.data) || { entries: [], totalQuantity: 0 };
    });
  }

  function postEntry(itemId, sku, quantity) {
    var body = JSON.stringify({
      itemId: String(itemId),
      sku: String(sku),
      quantity: quantity,
      additionalFields: JSON.stringify({})
    });
    return request('/api/commerce/shopping-cart/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Add-To-Cart-Id': uuid() },
      body: body
    }).then(function (r) {
      if (!r.ok || !(r.data && r.data.shoppingCart)) {
        throw r.error || new Error('Could not add ' + sku);
      }
      return r.data.shoppingCart;
    });
  }

  function clearCart(cart) {
    if (!cart || cart.empty) return Promise.resolve();
    var entries = cart.entries || [];
    var token = cart.cartToken;
    if (!entries.length || !token) return Promise.resolve();
    return entries.reduce(function (chain, entry) {
      return chain.then(function () {
        if (!entry || !entry.id) return;
        return request('/api/3/commerce/cart/' + encodeURIComponent(token) + '/items/' + encodeURIComponent(entry.id), {
          method: 'DELETE'
        });
      });
    }, Promise.resolve());
  }

  function setShipAustralia(token) {
    if (!token) return Promise.resolve();
    return request('/api/3/commerce/cart/' + encodeURIComponent(token) + '/shipping/location', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'AU' })
    }).catch(function () { return null; });
  }

  function applyCoupon(token, code) {
    return request('/api/3/commerce/cart/' + encodeURIComponent(token) + '/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ giftOrPromoCode: code })
    });
  }

  function loadMap() {
    var cacheKey = 'asw_meta_id_map_v2';
    try {
      var cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (parsed && parsed.map && parsed.at && (Date.now() - parsed.at) < 6 * 60 * 60 * 1000) {
          return Promise.resolve(parsed.map);
        }
      }
    } catch (e) {}
    function fetchOne(i) {
      if (i >= MAP_URLS.length) return Promise.reject(new Error('Could not load product map'));
      return fetch(MAP_URLS[i], { credentials: 'omit', cache: 'no-cache' }).then(function (res) {
        if (!res.ok) return fetchOne(i + 1);
        return res.json().then(function (map) {
          if (!map || typeof map !== 'object') return fetchOne(i + 1);
          return map;
        }).catch(function () { return fetchOne(i + 1); });
      }).catch(function () { return fetchOne(i + 1); });
    }
    return fetchOne(0).then(function (map) {
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), map: map })); } catch (e) {}
      return map;
    });
  }

  function moneyCents(cart) {
    if (!cart) return '';
    var cents = cart.subtotalCents;
    if (!cents) {
      var entries = cart.entries || [];
      cents = entries.reduce(function (s, e) {
        if (e.subTotal) return s + e.subTotal;
        var unit = e.purchasePriceCents || (e.chosenVariant && e.chosenVariant.price) || 0;
        return s + unit * (e.quantity || 0);
      }, 0);
    }
    if (!cents) return '';
    return (cents / 100).toFixed(2);
  }

  function goToCheckout() {
    window.location.replace('/checkout' + trackingQuery());
  }

  function showContinue(couponNote) {
    var extra = couponNote ? ('<p class="asw-muted">' + couponNote + '</p>') : '';
    setDetail(extra + '<button type="button" class="asw-btn" id="asw-meta-continue">Continue to checkout</button>');
    var btn = $('asw-meta-continue');
    if (btn) btn.addEventListener('click', goToCheckout);
  }

  window.__aswMetaCheckout = { parseProducts: parseProducts, getCart: getCart, readCoupon: readCoupon };

  ready(function () {
    var q = params();
    var list = parseProducts(q.get('products'));
    var coupon = readCoupon(q);
    mount();

    if (!list.length) {
      setStatus('This checkout link has no products.', 'asw-error');
      setDetail('<p class="asw-muted">If you were sent here from Facebook or Instagram, please go back and try again, or <a class="asw-linkish" href="/store-1">shop the site</a>.</p>');
      return;
    }

    var invalid = list.filter(function (p) { return p.error; });
    var wanted = list.filter(function (p) { return !p.error; });
    if (!wanted.length) {
      setStatus('This checkout link could not be read.', 'asw-error');
      setDetail('<ul class="asw-error">' + invalid.map(function (p) {
        return '<li>' + escapeHtml(p.id) + ' — ' + escapeHtml(p.error) + '</li>';
      }).join('') + '</ul>');
      return;
    }

    var added = [];
    var failed = invalid.slice();
    var couponNote = '';

    loadMap().then(function (map) {
      wanted.forEach(function (p) {
        if (!lookupProductId(map, p.id)) failed.push({ id: p.id, qty: p.qty, error: 'Unknown product id' });
      });
      var toAdd = wanted.filter(function (p) { return lookupProductId(map, p.id); });
      if (!toAdd.length) {
        setStatus('None of these products could be added.', 'asw-error');
        setDetail('<ul class="asw-error">' + failed.map(function (p) {
          return '<li>' + escapeHtml(p.id) + (p.error ? ' — ' + escapeHtml(p.error) : '') + '</li>';
        }).join('') + '</ul><p><a class="asw-linkish" href="/store-1">Shop the site</a></p>');
        return Promise.reject({ handled: true });
      }
      return getCart().then(function (cart) {
        return clearCart(cart);
      }).then(function () {
        return toAdd.reduce(function (chain, p) {
          return chain.then(function () {
            var itemId = lookupProductId(map, p.id);
            return postEntry(itemId, p.id, p.qty).then(function (cart) {
              added.push({ id: p.id, qty: p.qty, cart: cart });
              return cart;
            }).catch(function (err) {
              failed.push({ id: p.id, qty: p.qty, error: (err && err.message) || 'Could not add to cart' });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        return getCart().then(function (cart) {
          var last = added.length && added[added.length - 1].cart;
          if (last) {
            if (!cart.subtotalCents && last.subtotalCents) cart.subtotalCents = last.subtotalCents;
            if (!cart.cartToken && last.cartToken) cart.cartToken = last.cartToken;
            if ((!cart.entries || !cart.entries.length) && last.entries) cart.entries = last.entries;
            if (cart.totalQuantity == null && last.totalQuantity != null) cart.totalQuantity = last.totalQuantity;
          }
          return cart;
        });
      }).then(function (cart) {
        var pin = (cart && cart.cartToken) ? setShipAustralia(cart.cartToken).then(function () { return cart; }) : Promise.resolve(cart);
        return pin.then(function () {
          if (coupon && cart && cart.cartToken && (cart.totalQuantity || (cart.entries || []).length)) {
            return applyCoupon(cart.cartToken, coupon).then(function (r) {
              if (r.ok) {
                couponNote = 'Promo code ' + escapeHtml(coupon) + ' has been applied.';
                return getCart().then(function (c2) {
                  if (c2) {
                    if (!c2.subtotalCents && cart.subtotalCents) c2.subtotalCents = cart.subtotalCents;
                    if (!c2.cartToken && cart.cartToken) c2.cartToken = cart.cartToken;
                    if ((!c2.entries || !c2.entries.length) && cart.entries) c2.entries = cart.entries;
                    if (c2.totalQuantity == null && cart.totalQuantity != null) c2.totalQuantity = cart.totalQuantity;
                  }
                  return c2 || cart;
                });
              }
              var msg = (r.data && (r.data.message || r.data.error)) || 'could not be applied automatically';
              couponNote = 'Promo code ' + escapeHtml(coupon) + ' ' + escapeHtml(String(msg)).replace(/[.<]$/, '') + '. Please enter it at checkout if it is valid.';
              return cart;
            });
          }
          return cart;
        });
      }).then(function (cart) {
        var qty = cart && (cart.totalQuantity != null) ? cart.totalQuantity : added.reduce(function (s, a) { return s + a.qty; }, 0);
        if (!qty) {
          setStatus('We could not add these items to your cart.', 'asw-error');
          setDetail('<ul class="asw-error">' + failed.map(function (p) {
            return '<li>' + escapeHtml(p.id) + (p.error ? ' — ' + escapeHtml(p.error) : '') + '</li>';
          }).join('') + '</ul><p><a class="asw-linkish" href="/store-1">Shop the site</a></p>');
          return;
        }
        var sub = moneyCents(cart);
        var okMsg = 'Added ' + qty + ' item' + (qty === 1 ? '' : 's') + ' to your cart' + (sub ? ' · subtotal A$' + sub : '') + '. Taking you to checkout...';
        setStatus(okMsg, 'asw-ok');
        if (failed.length || couponNote) {
          var html = '';
          if (failed.length) {
            html += '<p>Some items could not be added:</p><ul class="asw-error">' + failed.map(function (p) {
              return '<li>' + escapeHtml(p.id) + (p.error ? ' — ' + escapeHtml(p.error) : '') + '</li>';
            }).join('') + '</ul>';
          }
          if (couponNote) html += '<p class="asw-muted">' + couponNote + '</p>';
          setDetail(html);
        }
        window.__aswMetaCheckout.lastCart = cart;
        window.__aswMetaCheckout.result = { added: added, failed: failed, couponNote: couponNote, subtotalCents: cart && cart.subtotalCents };
        var couponFailed = !!(coupon && couponNote && couponNote.indexOf('has been applied') < 0);
        if (failed.length || couponFailed) {
          showContinue(couponFailed && !failed.length ? couponNote : '');
          return;
        }
        setTimeout(goToCheckout, 500);
      });
    }).catch(function (err) {
      if (err && err.handled) return;
      setStatus('We could not start checkout.', 'asw-error');
      setDetail('<p class="asw-error">' + escapeHtml((err && err.message) || 'Please try again or shop on the website.') + '</p><p><a class="asw-linkish" href="/store-1">Shop the site</a></p>');
      window.__aswMetaCheckout.result = { error: (err && err.message) || String(err) };
    });
  });
})();
