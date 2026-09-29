import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import MeetingPage from './MeetingPage.jsx';
import { getMeetParamsFromUrl } from './api';
import './styles.css';

const meet = getMeetParamsFromUrl();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {meet ? <MeetingPage token={meet.token} event={meet.event} /> : <App />}
  </React.StrictMode>
);
