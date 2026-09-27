import { useEffect, useRef, useState } from 'react';
import { api } from './api';

const SEPARATOR = /[\s,;]/;

/** Word being typed at the caret: text since the last whitespace/comma/semicolon. */
function tokenAtCaret(value, caret) {
  let start = caret;
  while (start > 0 && !SEPARATOR.test(value[start - 1])) start -= 1;
  return { token: value.slice(start, caret), start };
}

function highlight(text, query) {
  if (!text) return null;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1 || !query) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function RecipientsInput({ value, onChange, eventId, rows = 6, placeholder }) {
  const ref = useRef(null);
  const reqId = useRef(0);
  const [query, setQuery] = useState({ token: '', start: 0, caret: 0 });
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const updateQuery = () => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const { token, start } = tokenAtCaret(el.value, caret);
    setQuery({ token, start, caret });
  };

  useEffect(() => {
    const q = query.token.trim();
    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      return undefined;
    }
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      try {
        const { items: found = [] } = await api.suggestRecipients(q, eventId);
        if (id !== reqId.current) return;
        const already = new Set(
          String(ref.current?.value || '')
            .toLowerCase()
            .split(SEPARATOR)
            .filter(Boolean)
        );
        const fresh = found.filter((s) => !already.has(s.email));
        setItems(fresh);
        setActive(0);
        setOpen(fresh.length > 0);
      } catch {
        if (id === reqId.current) setOpen(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query.token, eventId]);

  const pick = (email) => {
    const before = value.slice(0, query.start);
    const after = value.slice(query.caret).replace(/^[^\s,;]*/, '');
    const needsBreak = !/^\s/.test(after);
    const next = `${before}${email}${needsBreak ? '\n' : ''}${after}`;
    onChange(next);
    setOpen(false);
    setItems([]);
    const caret = before.length + email.length + 1;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (e) => {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(items[active].email);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const q = query.token.trim();

  return (
    <div className="recipients-input">
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(updateQuery);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateQuery();
        }}
        onClick={updateQuery}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && items.length > 0 && (
        <ul className="suggest-list" role="listbox">
          {items.map((s, i) => (
            <li
              key={s.email}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s.email);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="suggest-email">{highlight(s.email, q)}</span>
              {(s.name || s.company) && (
                <span className="suggest-meta">
                  {highlight([s.name, s.company].filter(Boolean).join(' · '), q)}
                </span>
              )}
              {s.in_event && <span className="suggest-tag">in this event</span>}
            </li>
          ))}
          <li className="suggest-hint" aria-hidden="true">
            ↑↓ to move · Enter or Tab to add · Esc to close
          </li>
        </ul>
      )}
    </div>
  );
}
