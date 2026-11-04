// Form kontrol yardimcilari: etiket, option ve form verisi kurallari.
// Yerlesim, boyama, dogrulama ve gonderim ayni yardimcilari kullanir.

export function controlType(el) {
  return String(el?.getAttribute?.('type') || 'text').toLowerCase();
}

/* input[type=submit/reset] icin varsayilan etiket; value niteligi varsa o.
   button elemaninda etiket iceriktir (value degil). */
export function controlLabel(el) {
  if (!el) return '';
  const value = el.getAttribute('value');
  if (el.localName === 'button') return el.textContent || value || '';
  if (value != null && value !== '') return value;
  const type = controlType(el);
  if (type === 'submit') return 'Gönder';
  if (type === 'reset') return 'Sıfırla';
  return value ?? '';
}

/* <button> icin tip verilmemisse submit'tir; input'ta varsayilan text. */
export function buttonAction(el) {
  if (!el) return null;
  if (el.localName === 'button') {
    const type = String(el.getAttribute('type') || 'submit').toLowerCase();
    return ['submit', 'reset', 'button'].includes(type) ? type : 'submit';
  }
  if (el.localName === 'input') {
    const type = controlType(el);
    if (type === 'submit' || type === 'reset' || type === 'button' || type === 'image') return type;
  }
  return null;
}

export function isTextControl(el) {
  if (!el) return false;
  if (el.localName === 'textarea') return true;
  if (el.localName !== 'input') return false;
  return ['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(controlType(el));
}

export function optionElements(select) {
  if (!select || select.localName !== 'select') return [];
  return select.querySelectorAll('option');
}

export function optionLabel(option) {
  if (!option) return '';
  return String(option.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function optionValue(option) {
  if (!option) return '';
  const attr = option.getAttribute('value');
  return attr != null ? attr : optionLabel(option);
}

export function defaultSelectIndex(select) {
  const options = optionElements(select);
  if (!options.length) return -1;
  const marked = options.findIndex((option) => option.hasAttribute('selected'));
  return marked >= 0 ? marked : 0;
}

export function selectedOptionIndex(select) {
  if (!select || select.localName !== 'select') return -1;
  const options = optionElements(select);
  if (!options.length) return -1;
  const runtime = select._selectedIndex;
  if (Number.isInteger(runtime)) {
    return runtime >= 0 && runtime < options.length ? runtime : -1;
  }
  return defaultSelectIndex(select);
}

export function selectedOption(select) {
  const index = selectedOptionIndex(select);
  return index >= 0 ? optionElements(select)[index] ?? null : null;
}

export function findOptionIndexByValue(select, value) {
  const wanted = String(value ?? '');
  return optionElements(select).findIndex((option) => optionValue(option) === wanted);
}

export function selectedOptionIndexes(select) {
  const options = optionElements(select);
  if (!options.length) return [];
  if (select.hasAttribute('multiple')) {
    /* _selected null/undefined ise nitelik baslangic secimini verir;
       motor bir kez secim yazinca yalnizca _selected sayilir. */
    return options
      .map((option, index) => ((option._selected ?? option.hasAttribute('selected')) ? index : -1))
      .filter((index) => index >= 0);
  }
  const index = selectedOptionIndex(select);
  return index >= 0 ? [index] : [];
}

/* select[multiple]: satir yuksekligi ve gorunen satir sayisi (size niteligi). */
export function multiSelectRowHeight(select) {
  const fs = select?._style?.fontSize || 16;
  const lh = typeof select?._style?.lineHeight === 'number' && select._style.lineHeight > 0
    ? select._style.lineHeight : fs * 1.4;
  return lh;
}

export function multiSelectRows(select) {
  const size = parseInt(select?.getAttribute?.('size'), 10);
  const requested = Number.isFinite(size) && size > 0 ? Math.min(size, 99) : 4;
  const count = optionElements(select).length;
  return Math.max(1, Math.min(requested, count || requested));
}

/* Canli form verisi: basarili kontroller sirasiyla [ad, deger] ciftleri.
   Gonderici dugme yalnizca gercekten formu tetikleyense eklenir. */
export function collectFormData(form, submitter = null) {
  if (!form) return [];
  const pairs = [];
  const controls = form.querySelectorAll('input, textarea, select, button');
  for (const control of controls) {
    if (isDisabled(control)) continue;
    const name = control.getAttribute('name');
    const local = control.localName;
    const type = local === 'input' ? controlType(control) : local === 'button' ? buttonAction(control) : local;

    if (local === 'button') {
      if (control !== submitter) continue;
      if (!name) continue;
      pairs.push([name, control.getAttribute('value') ?? '']);
      continue;
    }

    if (local === 'input') {
      if (['submit', 'reset', 'button', 'image'].includes(type)) {
        if (control !== submitter || !name) continue;
        pairs.push([name, control.getAttribute('value') ?? '']);
        continue;
      }
      if (type === 'file') continue;
      if (type === 'checkbox' || type === 'radio') {
        if (!control.checked || !name) continue;
        pairs.push([name, control.getAttribute('value') ?? 'on']);
        continue;
      }
    }

    if (!name) continue;

    if (local === 'select') {
      const options = optionElements(control);
      if (control.hasAttribute('multiple')) {
        for (const option of options) {
          if (option.disabled || !option.selected) continue;
          pairs.push([name, optionValue(option)]);
        }
      } else {
        const option = selectedOption(control);
        if (option && !option.disabled) pairs.push([name, optionValue(option)]);
      }
      continue;
    }

    const value = local === 'textarea'
      ? String(control.value ?? '').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n')
      : String(control.value ?? '');
    pairs.push([name, value]);
  }
  return pairs;
}

export function isDisabled(el) {
  if (!el) return true;
  if (el.hasAttribute?.('disabled')) return true;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (parent.localName === 'fieldset' && parent.hasAttribute('disabled')) return true;
  }
  return false;
}

/* action/method/enctype: submitter nitelikleri formunkini geçersiz kilar. */
export function buildFormRequest(form, submitter, baseUrl) {
  const pairs = collectFormData(form, submitter);
  const methodRaw = String(
    submitter?.getAttribute?.('formmethod') || form?.getAttribute?.('method') || 'get',
  ).toLowerCase();
  const method = methodRaw === 'post' ? 'post' : 'get';
  const action = submitter?.getAttribute?.('formaction') || form?.getAttribute?.('action') || baseUrl;
  const actionUrl = new URL(action || baseUrl, baseUrl);
  const enctype = String(
    submitter?.getAttribute?.('formenctype') || form?.getAttribute?.('enctype') || 'application/x-www-form-urlencoded',
  ).toLowerCase();

  const params = new URLSearchParams();
  for (const [name, value] of pairs) params.append(name, value);

  if (method === 'get') {
    actionUrl.search = params.toString();
    actionUrl.hash = '';
    return {
      url: actionUrl.href,
      method: 'GET',
      headers: {},
      body: null,
      pairs,
      enctype,
    };
  }

  if (enctype === 'multipart/form-data') {
    const body = new FormData();
    for (const [name, value] of pairs) body.append(name, value);
    return {
      url: actionUrl.href,
      method: 'POST',
      headers: {},
      body,
      pairs,
      enctype,
    };
  }

  if (enctype === 'text/plain') {
    return {
      url: actionUrl.href,
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: pairs.map(([name, value]) => `${name}=${value}`).join('\r\n') + '\r\n',
      pairs,
      enctype,
    };
  }

  return {
    url: actionUrl.href,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params.toString(),
    pairs,
    enctype: 'application/x-www-form-urlencoded',
  };
}
