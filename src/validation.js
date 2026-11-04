// HTML kisit dogrulamasi: required, type, pattern, uzunluk ve sayi araligi.
// DOM elemanlari checkValidity/reportValidity ile bu modulu kullanir.

import {
  controlType,
  isDisabled,
  isTextControl,
  selectedOption,
  selectedOptionIndexes,
} from './form.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function inputType(el) {
  return el?.localName === 'input' ? controlType(el) : '';
}

export function isBarredFromValidation(el) {
  if (!el || el.nodeType !== 1) return true;
  const local = el.localName;
  if (!['input', 'textarea', 'select', 'button'].includes(local)) return true;
  if (isDisabled(el)) return true;
  if (el.hasAttribute('readonly') && (local === 'textarea' || local === 'input')) return true;
  if (local === 'button') return true;
  if (local === 'input') {
    const type = inputType(el);
    if (['hidden', 'button', 'submit', 'reset', 'image', 'file'].includes(type)) return true;
  }
  return false;
}

function numericValue(el) {
  const raw = String(el.value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function radioGroupChecked(el) {
  const name = el.getAttribute('name');
  if (!name) return !!el.checked;
  const scope = el.closest?.('form') ?? el.ownerDocument;
  if (!scope) return !!el.checked;
  return scope.querySelectorAll('input').some((other) => other !== el
    && inputType(other) === 'radio'
    && other.getAttribute('name') === name
    && other.checked);
}

function valueMissing(el) {
  if (!el.hasAttribute('required')) return false;
  const local = el.localName;
  const type = inputType(el);
  if (local === 'input' && (type === 'checkbox' || type === 'radio')) {
    return local === 'input' && type === 'radio' ? !el.checked && !radioGroupChecked(el) : !el.checked;
  }
  if (local === 'select') {
    if (el.hasAttribute('multiple')) {
      /* required + multiple: en az bir secili (ve etkin) option gerekir. */
      return selectedOptionIndexes(el).length === 0;
    }
    return selectedOption(el) == null || String(el.value) === '';
  }
  return String(el.value ?? '') === '';
}

function typeMismatch(el) {
  const type = inputType(el);
  const value = String(el.value ?? '');
  if (!value) return false;
  if (type === 'email') {
    if (el.hasAttribute('multiple')) {
      return value.split(',').some((part) => !EMAIL_RE.test(part.trim()));
    }
    return !EMAIL_RE.test(value.trim());
  }
  if (type === 'url') {
    if (!URL_SCHEME_RE.test(value.trim())) return true;
    try { new URL(value.trim()); return false; } catch { return true; }
  }
  if (type === 'number') return numericValue(el) == null;
  return false;
}

function patternMismatch(el) {
  const type = inputType(el);
  if (type && type !== 'text' && type !== 'search' && type !== 'tel' && type !== 'email' && type !== 'url') return false;
  const pattern = el.getAttribute('pattern');
  const value = String(el.value ?? '');
  if (pattern == null || value === '') return false;
  try {
    return !new RegExp(`^(?:${pattern})$`, 'u').test(value);
  } catch {
    return false;
  }
}

function lengthMismatch(el) {
  if (!isTextControl(el)) return { tooShort: false, tooLong: false };
  const value = String(el.value ?? '');
  if (!value) return { tooShort: false, tooLong: false };
  const min = parseInt(el.getAttribute('minlength'), 10);
  const max = parseInt(el.getAttribute('maxlength'), 10);
  return {
    tooShort: Number.isFinite(min) && min > 0 && value.length < min,
    tooLong: Number.isFinite(max) && max >= 0 && value.length > max,
  };
}

function rangeMismatch(el) {
  if (inputType(el) !== 'number') {
    return { rangeUnderflow: false, rangeOverflow: false, stepMismatch: false };
  }
  const value = numericValue(el);
  if (value == null) return { rangeUnderflow: false, rangeOverflow: false, stepMismatch: false };
  const minRaw = el.getAttribute('min');
  const maxRaw = el.getAttribute('max');
  const min = minRaw != null && minRaw !== '' ? Number(minRaw) : null;
  const max = maxRaw != null && maxRaw !== '' ? Number(maxRaw) : null;
  const rangeUnderflow = min != null && Number.isFinite(min) && value < min;
  const rangeOverflow = max != null && Number.isFinite(max) && value > max;
  let stepMismatch = false;
  const stepRaw = el.getAttribute('step');
  if (stepRaw != null && String(stepRaw).toLowerCase() !== 'any') {
    const step = stepRaw === '' ? 1 : Number(stepRaw);
    if (Number.isFinite(step) && step > 0) {
      const base = min != null && Number.isFinite(min) ? min : 0;
      const ratio = (value - base) / step;
      stepMismatch = Math.abs(ratio - Math.round(ratio)) > 1e-7;
    }
  }
  return { rangeUnderflow, rangeOverflow, stepMismatch };
}

export function getValidationState(el) {
  const flags = {
    valueMissing: false,
    typeMismatch: false,
    patternMismatch: false,
    tooShort: false,
    tooLong: false,
    rangeUnderflow: false,
    rangeOverflow: false,
    stepMismatch: false,
    badInput: false,
    customError: false,
    valid: true,
  };
  if (isBarredFromValidation(el)) return { ...flags, message: '' };

  flags.valueMissing = valueMissing(el);
  flags.typeMismatch = typeMismatch(el);
  if (inputType(el) === 'number' && String(el.value ?? '') !== '' && numericValue(el) == null) {
    flags.badInput = true;
  }
  flags.patternMismatch = patternMismatch(el);
  const lengths = lengthMismatch(el);
  flags.tooShort = lengths.tooShort;
  flags.tooLong = lengths.tooLong;
  const range = rangeMismatch(el);
  flags.rangeUnderflow = range.rangeUnderflow;
  flags.rangeOverflow = range.rangeOverflow;
  flags.stepMismatch = range.stepMismatch;
  flags.customError = !!el._customValidity;
  flags.valid = !Object.entries(flags).some(([key, value]) => key !== 'valid' && value);

  let message = '';
  if (!flags.valid) {
    const type = inputType(el);
    if (flags.customError) {
      message = String(el._customValidity);
    } else if (flags.valueMissing) {
      if (el.localName === 'select') message = 'Lütfen listeden bir seçenek seçin.';
      else if (type === 'checkbox') message = 'Devam etmek için bu kutuyu işaretleyin.';
      else if (type === 'radio') message = 'Lütfen bir seçenek seçin.';
      else message = 'Lütfen bu alanı doldurun.';
    } else if (flags.typeMismatch || flags.badInput) {
      if (type === 'email') message = 'Lütfen geçerli bir e-posta adresi girin.';
      else if (type === 'url') message = 'Lütfen geçerli bir web adresi girin.';
      else if (type === 'number') message = 'Lütfen bir sayı girin.';
      else message = 'Lütfen geçerli bir değer girin.';
    } else if (flags.patternMismatch) {
      message = 'Lütfen istenen biçimle eşleşen bir değer girin.';
    } else if (flags.tooShort) {
      message = `En az ${el.getAttribute('minlength')} karakter girin.`;
    } else if (flags.tooLong) {
      message = `En fazla ${el.getAttribute('maxlength')} karakter girin.`;
    } else if (flags.rangeUnderflow) {
      message = `Değer en az ${el.getAttribute('min')} olmalı.`;
    } else if (flags.rangeOverflow) {
      message = `Değer en fazla ${el.getAttribute('max')} olmalı.`;
    } else if (flags.stepMismatch) {
      message = 'Lütfen geçerli bir adım değeri girin.';
    } else {
      message = 'Lütfen bu alanı kontrol edin.';
    }
  }
  return { ...flags, message };
}

export function isValidatableFormControl(el) {
  if (!el || el.nodeType !== 1) return false;
  if (!['input', 'textarea', 'select'].includes(el.localName)) return false;
  return !isBarredFromValidation(el);
}
