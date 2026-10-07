import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import MeetingPage from './MeetingPage.jsx';
import PublicPulsePage from './PublicPulsePage.jsx';
import { getMeetParamsFromUrl, getPulseShareTokenFromUrl } from './api';
import './styles.css';

const meet = getMeetParamsFromUrl();
const pulseToken = getPulseShareTokenFromUrl();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {pulseToken ? (
      <PublicPulsePage token={pulseToken} />
    ) : meet ? (
      <MeetingPage token={meet.token} event={meet.event} />
    ) : (
      <App />
    )}
  </React.StrictMode>
);
