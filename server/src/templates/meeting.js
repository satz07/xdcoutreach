/** Replaced per recipient at send time with their signed meeting-form link (services/leads.js). */
const MEETING_PLACEHOLDER = '{{MEETING_URL}}';

/** Meeting buttons use the lead form unless the template explicitly opts out. */
function usesMeetingForm(value) {
  return !(value === false || value === 'false');
}

module.exports = { MEETING_PLACEHOLDER, usesMeetingForm };
