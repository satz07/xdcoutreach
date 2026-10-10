import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import MeetingPage from './MeetingPage.jsx';
import PublicPulsePage from './PublicPulsePage.jsx';
import SponsorPage from './SponsorPage.jsx';
import { getMeetParamsFromUrl, getPulseShareTokenFromUrl, getSponsorTokenFromUrl } from './api';
import './styles.css';

const meet = getMeetParamsFromUrl();
const pulseToken = getPulseShareTokenFromUrl();
const sponsorToken = getSponsorTokenFromUrl();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {sponsorToken ? (
      <SponsorPage token={sponsorToken} />
    ) : pulseToken ? (
      <PublicPulsePage token={pulseToken} />
    ) : meet ? (
      <MeetingPage token={meet.token} event={meet.event} />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
