const TEXT_FIELDS = [
  ['greeting', 'Greeting', 1, 'Use {{first_name}} for the recipient\'s first name — dropped automatically when unknown'],
  ['intro', 'Intro', 4, 'Blank line = new paragraph'],
  ['highlight', 'Highlight line', 1, 'Shown large between gold rules'],
  ['body', 'Body', 3, 'Blank line = new paragraph'],
  ['bulletsTitle', 'List title', 1, ''],
  ['bulletsText', 'List items', 6, 'One per line'],
  ['eventTitle', 'Event card title', 1, ''],
  ['eventDetailsText', 'Event card details', 3, 'One per line, e.g. 📍 Dubai, UAE'],
  ['tagline', 'Event card tagline', 1, ''],
  ['closing', 'Closing', 2, ''],
  ['signOff', 'Sign-off', 3, ''],
  ['footerNote', 'Footer note', 2, 'Small grey text at the bottom'],
];

export default function SimpleInviteFields({ content, updateField }) {
  const field = (key) => content[key] ?? '';
  return (
    <>
      <label>
        Headline <span className="hint">(email title and template name)</span>
        <input value={field('headline')} onChange={(e) => updateField('headline', e.target.value)} />
      </label>
      <div className="row-2">
        <label>
          Button label
          <input value={field('ctaLabel')} onChange={(e) => updateField('ctaLabel', e.target.value)} />
        </label>
        <label>
          Button link
          <input
            value={field('ctaUrl')}
            placeholder="https://…"
            onChange={(e) => updateField('ctaUrl', e.target.value)}
          />
        </label>
      </div>
      {TEXT_FIELDS.map(([key, label, rows, hint]) => (
        <label key={key}>
          {label} {hint && <span className="hint">({hint})</span>}
          {rows > 1 ? (
            <textarea rows={rows} value={field(key)} onChange={(e) => updateField(key, e.target.value)} />
          ) : (
            <input value={field(key)} onChange={(e) => updateField(key, e.target.value)} />
          )}
        </label>
      ))}
      <div className="row-2">
        <label>
          Main colour
          <input value={field('primaryColor')} onChange={(e) => updateField('primaryColor', e.target.value)} />
        </label>
        <label>
          Button colour
          <input value={field('ctaColor')} onChange={(e) => updateField('ctaColor', e.target.value)} />
        </label>
      </div>
      <p className="hint">
        Use **double stars** for bold and [label](https://link) for links in the text fields.
      </p>
    </>
  );
}
