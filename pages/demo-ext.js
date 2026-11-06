/* Harici script demosu: motor bu dosyayi fetch ile cekip belge
   sirasindaki inline scriptlerden once calistirir. */
console.log('demo-ext.js: harici script calisti');
var extStatus = document.getElementById('ext-status');
if (extStatus) {
  extStatus.textContent = 'Bu bölümün stili demo-ext.css dosyasından, bu yazı demo-ext.js dosyasından geldi.';
}