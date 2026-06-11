import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
} from "react-router-dom";

import Layout from "../Layout/Layout";
import Login from "../pages/authentication/Login";
import FbAccountDetails from "../pages/user/FbAccountDetails";
import Dashboard from "../components/Dashboard";
import UserDetails from "../components/UserDetails";
import GeneratedMedia from "../components/GeneratedMedia";
import PasDashboard from "../components/Pas/Dashboard";
import LogOut from "../pages/authentication/LogOut";
import AuthCheck from "../pages/authentication/AuthCheck";
import CrawlerInsight from "../pages/user/CrawlerInsight";
import Facebook from "../components/Pas/CrawlerInsight/Facebook";
import GDN from "../components/Pas/CrawlerInsight/GDN";
import Google from "../components/Pas/CrawlerInsight/Google";
import Insta from "../components/Pas/CrawlerInsight/Insta";
import Linkedin from "../components/Pas/CrawlerInsight/Linkedin";
import Native from "../components/Pas/CrawlerInsight/Native";
import Pinterest from "../components/Pas/CrawlerInsight/Pinterest";
import Quora from "../components/Pas/CrawlerInsight/Quora";
import Reddit from "../components/Pas/CrawlerInsight/Reddit";
import Tiktok from "../components/Pas/CrawlerInsight/Tiktok";
import Youtube from "../components/Pas/CrawlerInsight/Youtube";
import SystemInfo from "../pages/user/SystemInfo";
import CompetitorDetails from "../components/Pas/CompetitorDetails"
import DailyKeywordDetails from "../components/Pas/DailyKeywordDetails"
import Calculator from "../components/Calculator"
import EmailDetails from "../components/Pas/EmailDetails"
import CompetitorTracker from "../components/Pas/CompetitorTracker"
import SearchIntelligence from "../components/Pas/Intelligence/SearchIntelligence"

export const routes = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="" element={<Login />} />
      <Route path="/log-out" element={<LogOut />} />

      {/* Protected Route */}
      <Route path="/adsgpt" element={<AuthCheck><Layout /></AuthCheck>}>
        <Route index element={<AuthCheck><Dashboard /></AuthCheck>} />
        <Route path="userdetails/:user_id" element={<AuthCheck><UserDetails /></AuthCheck>} />
        <Route path="generated-media" element={<AuthCheck><GeneratedMedia /></AuthCheck>} />
        <Route path="generated-media/:user_id" element={<AuthCheck><GeneratedMedia /></AuthCheck>} />
        <Route path="calculation" element={<AuthCheck><Calculator /></AuthCheck>} />
      </Route>

      <Route path="/pas" element={<AuthCheck><Layout /></AuthCheck>}>
        <Route index element={<AuthCheck><PasDashboard /></AuthCheck>} />
        <Route path="competitor-details" element={<AuthCheck><CompetitorDetails /></AuthCheck>} />
        <Route path="daily-keyword-details" element={<AuthCheck><DailyKeywordDetails /></AuthCheck>} />
        <Route path="email-details" element={<AuthCheck><EmailDetails /></AuthCheck>} />
        <Route path="competitor-tracker" element={<AuthCheck><CompetitorTracker /></AuthCheck>} />
        <Route path="search-intelligence" element={<AuthCheck><SearchIntelligence /></AuthCheck>} />
        <Route path="system-info" element={<AuthCheck><SystemInfo /></AuthCheck>} />
        <Route path="crawler-insights" element={<AuthCheck><CrawlerInsight /></AuthCheck>}>
          <Route index element={<AuthCheck><Facebook /></AuthCheck>} />
          <Route path="gdn" element={<AuthCheck><GDN /></AuthCheck>} />
          <Route path="google" element={<AuthCheck><Google /></AuthCheck>} />
          <Route path="instagram" element={<AuthCheck><Insta /></AuthCheck>} />
          <Route path="linkedin" element={<AuthCheck><Linkedin /></AuthCheck>} />
          <Route path="native" element={<AuthCheck><Native /></AuthCheck>} />
          <Route path="pinterest" element={<AuthCheck><Pinterest /></AuthCheck>} />
          <Route path="quora" element={<AuthCheck><Quora /></AuthCheck>} />
          <Route path="reddit" element={<AuthCheck><Reddit /></AuthCheck>} />
          <Route path="tiktok" element={<AuthCheck><Tiktok /></AuthCheck>} />
          <Route path="youtube" element={<AuthCheck><Youtube /></AuthCheck>} />
        </Route>
        <Route path="fb-accountdetails" element={<AuthCheck><FbAccountDetails /></AuthCheck>} />
      </Route>
      {/* Redirect any unknown route */}
      <Route path="*" element={<Navigate to="/" />} />
    </>
  )
);
