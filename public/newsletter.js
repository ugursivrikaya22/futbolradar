/* Bülten abonelik formu: bal küpü + zaman damgası, fetch ile gönderim, durum mesajları. */
(function () {
  'use strict';
  var flashText = { onaylandi: 'Aboneliğin onaylandı! İlk bülten pazartesi sabahı e-postanda.', ayrildi: 'Abonelikten çıktın. Bir daha bülten gönderilmeyecek.', gecersiz: 'Onay bağlantısı geçersiz ya da süresi dolmuş. Lütfen yeniden kayıt ol.', hata: 'Bir sorun oluştu, lütfen biraz sonra tekrar dene.' };
  var flash = document.querySelector('[data-newsletter-flash]');
  var state = new URLSearchParams(location.search).get('durum');
  if (flash && state && flashText[state]) { flash.textContent = flashText[state]; flash.hidden = false; }
  Array.prototype.forEach.call(document.querySelectorAll('[data-newsletter-form]'), function (form) {
    var t = form.querySelector('[data-newsletter-t]'); if (t) t.value = String(Date.now());
    var status = form.querySelector('[data-newsletter-status]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = Object.fromEntries(new FormData(form).entries());
      data.consent = !!form.querySelector('[name="consent"]:checked');
      if (!data.consent) { status.textContent = 'Devam etmek için rıza kutusunu işaretle.'; return; }
      var btn = form.querySelector('button[type="submit"]'); btn.disabled = true; status.textContent = 'Gönderiliyor…';
      fetch('/api/newsletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (p) {
          if (p && p.ok) { status.textContent = (p.data && p.data.message) || 'Onay e-postası gönderildi.'; form.reset(); }
          else status.textContent = (p && p.error && p.error.message) || 'Kayıt alınamadı, lütfen tekrar dene.';
        })
        .catch(function () { status.textContent = 'Bağlantı hatası, lütfen tekrar dene.'; })
        .then(function () { btn.disabled = false; if (t) t.value = String(Date.now() - 5000); });
    });
  });
})();
