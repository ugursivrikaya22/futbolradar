(function () {
  'use strict';
  document.querySelectorAll('[data-page-share-copy]').forEach(function (button) {
    button.hidden = false;
    button.addEventListener('click', async function () {
      var section = button.closest('[data-page-share]');
      var status = section.querySelector('[data-page-share-status]');
      var fallback = section.querySelector('[data-page-share-fallback]');
      button.disabled = true;
      status.textContent = '';
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('clipboard-unavailable');
        await navigator.clipboard.writeText(button.getAttribute('data-page-share-copy'));
        fallback.hidden = true;
        status.textContent = 'Bağlantı kopyalandı.';
      } catch (error) {
        fallback.hidden = false;
        var input = fallback.querySelector('input');
        input.focus();
        input.select();
        status.textContent = 'Otomatik kopyalanamadı. Seçili bağlantıyı kopyalayabilirsiniz.';
      } finally {
        button.disabled = false;
      }
    });
  });
}());
