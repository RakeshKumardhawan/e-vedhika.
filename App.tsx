/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Bell, Menu, X, Home, Megaphone, FileText, Wheat, Vote, 
  Wallet, Building, MessageCircle, Handshake, Lightbulb, 
  AlertTriangle, Send, LogOut, ChevronDown, ChevronUp, Search,
  Eye, Heart, Share2, PlusCircle, Camera, User, Edit2, Save,
  Activity, Book, GraduationCap, BarChart3, Database, Download, Bot, Sparkles, MessageSquare,
  Trash2, Edit3, Settings, TrendingUp, Upload, Play, RefreshCw, Layers, Calendar, LayoutDashboard, ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import * as XLSX from 'xlsx';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from 'recharts';
import { 
  onAuthStateChanged, signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, signOut, signInAnonymously,
  GoogleAuthProvider, signInWithPopup
} from 'firebase/auth';
import { 
  collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc,
  increment, arrayUnion, query, orderBy, limit, setDoc, getDoc, where
} from 'firebase/firestore';
import { auth, db, legacyDb } from './lib/firebase';
import firebaseConfig from '../firebase-applet-config.json';
import { Post, Comment, ChatMessage, Suggestion, ProblemReport, UserProfile, RequestData } from './types';

// Helper for deep paths to retrieve old data
const appId = firebaseConfig.projectId || 'e-vedhika-258f2';
const publicCol = (name: string, useLegacy = true) => {
  return collection(legacyDb, name);
};
const publicDoc = (name: string, id: string, useLegacy = true) => {
  return doc(legacyDb, name, id);
};

// Helper for safe JSON stringification to handle circular structures from 3rd party libs
const safeStringify = (obj: any, indent = 2) => {
  const cache = new Set();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) return '[Circular]';
      cache.add(value);
    }
    return value;
  }, indent);
};

const cleanStringData = (val: any) => {
  if (val === null || val === undefined) return "";
  let str = String(val);
  
  // Decode HTML entities if they slipped through
  str = str.replace(/&lt;/gi, '<')
           .replace(/&gt;/gi, '>')
           .replace(/&amp;/gi, '&')
           .replace(/&quot;/gi, '"')
           .replace(/&apos;/gi, "'")
           .replace(/&nbsp;/gi, ' ')
           .replace(/&#[0-9]+;/g, '');

  // Remove messy wrapping symbols and multiple quotes
  str = str.replace(/[«»]/g, '')
           .replace(/[+"]+/g, '')
           .replace(/\t/g, ' ')
           .replace(/\n/g, ' ')
           .replace(/\r/g, ' ')
           .replace(/\s+/g, ' ');
  
  return str.trim();
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState('home');
  const [currentFilter, setCurrentFilter] = useState('All');
  const [posts, setPosts] = useState<Post[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [updates, setUpdates] = useState<string[]>([]);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [problemsGlobal, setProblemsGlobal] = useState<ProblemReport[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<{ id: number, msg: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  const [showPostForm, setShowPostForm] = useState(false);
  
  const [dbStatus, setDbStatus] = useState<string>("checking...");
  
  // Auth and Data Listeners
  useEffect(() => {
    // Connection is assumed successful if other reads work.
    setDbStatus("connected");

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
          // Sync profile
          const profileRef = doc(db, 'users', u.uid);
          const unsubProfile = onSnapshot(profileRef, (snap) => {
            if (snap.exists()) {
              setUserProfile({ id: snap.id, ...snap.data() } as UserProfile);
            } else if (!u.isAnonymous) {
              // Create default profile for first time real users
              const newProfile: Partial<UserProfile> = {
                username: u.email?.split('@')[0] || "Member",
                time: Date.now()
              };
              setDoc(profileRef, newProfile).catch(console.error);
            }
          }, (err) => console.error("Profile Error:", err));

          // Check Admin status
          const adminRef = doc(db, 'admins', u.uid);
          const snapAdmin = await getDoc(adminRef);
          setIsAdmin(snapAdmin.exists());

          return () => unsubProfile();
      } else {
        setUserProfile(null);
        setIsAdmin(false);
        signInAnonymously(auth).catch(err => {
          console.error("Auth Error:", err);
          if (err.code === 'auth/admin-restricted-operation') {
            addToast("⚠️ Setup Required: Please enable 'Anonymous Auth' in your Firebase Console to continue.");
          }
        });
      }
    });

    // Real-time Listeners
    const loadPosts = () => {
      return onSnapshot(query(publicCol('posts')), (snap) => {
        const pArr: Post[] = [];
        snap.forEach((d) => pArr.push({ id: d.id, ...d.data() } as Post));
        setPosts(pArr.sort((a, b) => {
          const getVal = (v: any) => {
            if (!v) return 0;
            if (v?.seconds) return v.seconds * 1000;
            return Number(v) || 0;
          };
          return getVal(b.time) - getVal(a.time);
        }));
      }, (err) => {
        console.error("Posts Error:", err);
        if (err.code === 'permission-denied') {
          addToast("Note: Some data access restricted by security rules.");
        }
      });
    };

    const unsubPosts = loadPosts();

    const chatQuery = query(publicCol('chat'));
    const unsubChat = onSnapshot(chatQuery, (snap) => {
      const cArr: ChatMessage[] = [];
      snap.forEach((d) => cArr.push({ id: d.id, ...d.data() } as ChatMessage));
      cArr.sort((a, b) => (a.time || 0) - (b.time || 0));
      // Only keep last 50
      setChatMessages(cArr.slice(-50));
    }, (err) => console.error("Chat Error:", err));

    const unsubUpdates = onSnapshot(publicCol('updates'), (snap) => {
      const uArr: string[] = [];
      snap.forEach(d => uArr.push(d.data().text));
      setUpdates(uArr);
    }, (err) => console.error("Updates Error:", err));

    const reqQuery = query(publicCol('requests'));
    const unsubReq = onSnapshot(reqQuery, (snap) => {
      const rArr: RequestData[] = [];
      snap.forEach(d => rArr.push({ id: d.id, ...d.data() } as RequestData));
      setRequests(rArr);
    }, (err) => console.error("Requests:", err));

    const suggQuery = query(publicCol('suggestions'));
    const unsubSugg = onSnapshot(suggQuery, (snap) => {
      const sArr: Suggestion[] = [];
      snap.forEach(d => {
        const data = d.data();
        // Show if not explicitly hidden or rejected
        if ((data.status || "approved").toLowerCase() !== "rejected") {
          sArr.push({ id: d.id, ...data } as Suggestion);
        }
      });
      setSuggestions(sArr);
    }, (err) => {
      console.error("Suggestions Error:", err);
      if (err.code === 'permission-denied') {
        addToast("Suggestions locked by permissions. Go to Firebase Console -> Firestore -> Rules to allow reads.");
      }
    });

    const probQuery = query(publicCol('problems'));
    const unsubProb = onSnapshot(probQuery, (snap) => {
      const pArr: ProblemReport[] = [];
      snap.forEach(d => pArr.push({ id: d.id, ...d.data() } as ProblemReport));
      setProblemsGlobal(pArr);
    }, (err) => console.error("Problems:", err));

    const scrollInterval = setInterval(() => {
      const box = document.getElementById("suggestionBox");
      if (!box) return;
      box.scrollTop++;
      if (box.scrollTop >= box.scrollHeight - box.clientHeight) box.scrollTop = 0;
    }, 40);

    return () => {
      unsubAuth();
      unsubPosts();
      unsubChat();
      unsubUpdates();
      unsubReq();
      unsubSugg();
      unsubProb();
      clearInterval(scrollInterval);
    };
  }, []);

  const addToast = (msg: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const target = e.target as any;
    const email = target.email.value;
    const pass = target.password.value;
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      addToast("Welcome back!");
    } catch (err: any) {
      if (err.code === 'auth/network-request-failed') {
        addToast("Network Error: Please try opening the app in a NEW TAB if login fails in the preview.");
      }
      try {
        await createUserWithEmailAndPassword(auth, email, pass);
        addToast("Account created!");
      } catch (innerErr: any) {
        console.error("Login Error:", innerErr);
        addToast("Login Failed: " + (innerErr.message || "Unknown error"));
      }
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      // Synchronize Profile with DisplayName
      const profileRef = doc(db, 'users', result.user.uid);
      await setDoc(profileRef, { 
        username: result.user.displayName || result.user.email?.split('@')[0],
      }, { merge: true });
      
      addToast("Google Login Success!");
    } catch (err: any) {
      console.error("Google Login Error:", err);
      if (err.code === 'auth/network-request-failed') {
        addToast("Network Error: Try opening the app in a NEW TAB (top-right button).");
      } else {
        addToast("Login Failed: " + err.message);
      }
    }
  };

  const togglePostExpansion = async (id: string) => {
    setExpandedPosts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

    // Increment views only when expanding
    if (!expandedPosts.has(id)) {
      try {
        const postRef = publicDoc('posts', id);
        await updateDoc(postRef, { views: increment(1) });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const filteredPosts = posts.filter(p => {
    const q = searchQuery.toLowerCase().trim();
    const tMatch = String(p.title || "").toLowerCase().includes(q);
    const cMatch = String(p.content || "").toLowerCase().includes(q);
    const searchOk = !q || tMatch || cMatch;
    
    // If searching, priority is search matches across all categories
    if (q) return searchOk;
    
    // HOME (All) - Show everything
    if (currentFilter === 'All') return true;
    
    // KNOWLEDGE HUB FILTERING
    const krCategories = ['Knowledge Repository', 'G.Os Center', 'Official SoPs', 'Imp Files'];
    if (krCategories.includes(currentFilter)) {
      if (currentFilter === 'Knowledge Repository') {
        const isPartOfKR = krCategories.includes(p.category || "") || krCategories.includes(p.subCategory || "");
        return isPartOfKR;
      }
      return p.category === currentFilter || p.subCategory === currentFilter;
    }
    
    // DEFAULT CATEGORY FILTERING (Union Updates, etc)
    return p.category === currentFilter || p.subCategory === currentFilter;
  });

  return (
    <>
      <div id="toastContainer" style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '12px', pointerEvents: 'none' }}>
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -20, scale: 0.9, x: 20 }}
              animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 20 }}
              style={{
                background: 'rgba(13, 59, 102, 0.95)',
                backdropFilter: 'blur(10px)',
                color: 'white',
                padding: '14px 24px',
                borderRadius: '16px',
                fontSize: '14px',
                fontWeight: 700,
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                pointerEvents: 'auto',
                maxWidth: '350px'
              }}
            >
              <div style={{ background: 'var(--accent)', width: '6px', height: '6px', borderRadius: '50%' }}></div>
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <header>
        <div className="brand-wrapper">
          <div className="logo-container" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <div className="logo-glow"></div>
            <svg viewBox="0 0 64 64" width="45" height="45" style={{ position: 'relative', zIndex: 2 }}>
              <g className="logo-ring" id="mainLogoRing">
                <circle cx="32" cy="32" r="29" fill="none" stroke="#facc15" strokeWidth="2.5" strokeDasharray="6 10"/>
              </g>
              <circle cx="32" cy="32" r="24" fill="#0d3b66"/>
              <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" className="ev-logo-text">EV</text>
            </svg>
          </div>
          <div>
            <h2 className="brand-title">E‑VEDHIKA</h2>
            <p className="sub-tagline">All Problems One Solution At One Place</p>
          </div>
        </div>
      </header>

      <div className="latest-bar">
        <span className="latest-label" style={{ background: 'linear-gradient(90deg, #ef4444, #f97316)', padding: '4px 10px', borderRadius: '4px', color: 'white', fontWeight: 900, fontSize: '10px' }}>📢 NEWS</span>
        <div className="latest-text">
          <span>{updates.length > 0 ? updates.join(' 🔥 ') : 'Welcome to E-Vedhika Portal... Stay tuned for daily PR & RD updates...'}</span>
        </div>
      </div>

      <div className="nav-trigger-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className={`menu-toggle ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(!sidebarOpen)} title="Menu">
            <span></span><span></span><span></span>
          </button>
          <div id="currentFilterLabel" style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '14px', letterSpacing: '0.5px' }}>
            {currentTab === 'home' ? (currentFilter === 'All' ? '🏠 HOME' : `🔍 ${currentFilter.toUpperCase()}`) : (
              currentTab === 'workspace' ? <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><LayoutDashboard size={16} style={{ color: '#0891b2' }} /> Mana Panchayath</span> : 
              currentTab === 'repo' ? '📚 KNOWLEDGE HUB' : 
              `📍 ${currentTab.toUpperCase()}`
            )}
          </div>
        </div>

        <div className="notif-bell" onClick={() => setUnreadCount(0)} title="Notifications">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <div className="notif-badge" style={{ display: unreadCount > 0 ? 'flex' : 'none' }}>{unreadCount}</div>
        </div>
      </div>

      <div className={`main-layout ${sidebarOpen ? 'sidebar-open' : ''}`} id="mainLayout">
        <aside className="sidebar">
          <div className="sidebar-content">
            <MenuButton label="Home" icon={Home} color="#1e40af" active={currentTab === 'home' && currentFilter === 'All'} onClick={() => { setCurrentTab('home'); setCurrentFilter('All'); setSidebarOpen(false); }} />
            <MenuButton label="Mana Panchayath" icon={LayoutDashboard} color="#0891b2" active={currentTab === 'workspace'} onClick={() => { setCurrentTab('workspace'); setSidebarOpen(false); }} />
            <MenuButton label="Knowledge Hub" icon={Book} color="#7c3aed" active={currentTab === 'home' && (currentFilter === 'Knowledge Repository' || currentFilter === 'G.Os Center' || currentFilter === 'Official SoPs' || currentFilter === 'Imp Files')} onClick={() => { setCurrentTab('home'); setCurrentFilter('Knowledge Repository'); setSidebarOpen(false); }} />
            <MenuButton label="Live Chat" icon={MessageSquare} color="#16a34a" active={currentTab === 'chat'} onClick={() => { setCurrentTab('chat'); setSidebarOpen(false); }} />
            <MenuButton label="Suggestions" icon={Sparkles} color="#db2777" active={currentTab === 'suggestions'} onClick={() => { setCurrentTab('suggestions'); setSidebarOpen(false); }} />
            {user && !user.isAnonymous && <MenuButton label="My Profile" icon={User} color="#475569" active={currentTab === 'profile'} onClick={() => { setCurrentTab('profile'); setSidebarOpen(false); }} />}
            {isAdmin && <MenuButton label="Admin Panel" icon={ShieldAlert} color="#dc2626" active={false} onClick={() => { window.open('https://e-vedhika.onrender.com/admin', '_blank'); }} />}
          </div>
        </aside>

        <main className="content-area">
          <AnimatePresence mode="wait">
            {currentTab === 'home' && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                {/* Account Section */}
                <div className="section-card card-gold flex justify-between items-center" style={{ padding: '15px' }}>
                  {user && !user.isAnonymous ? (
                    <div id="userInfo" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span id="welcomeUser" style={{ fontWeight: 700, fontSize: '15px' }}>
                        👤 Welcome, {userProfile?.username || user.email?.split('@')[0]}
                      </span>
                      <button onClick={() => signOut(auth)} style={{ background: 'var(--danger)', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                        Logout
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-4 items-center w-full">
                      <form onSubmit={handleLogin} id="loginForm" className="flex flex-wrap gap-2 items-center flex-1" style={{ margin: 0 }}>
                        <input name="email" type="email" placeholder="Email" required />
                        <input name="password" type="password" placeholder="Pass" required />
                        <button className="btn-primary" style={{ padding: '0 15px', height: '44px' }}>Login</button>
                      </form>
                      <button onClick={handleGoogleLogin} style={{ background: '#ea4335', color: 'white', border: 'none', borderRadius: '12px', padding: '0 20px', height: '44px', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}>G</button>
                    </div>
                  )}
                </div>

                {/* Search */}
                <div style={{ marginBottom: '25px' }}>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="🔍 Search updates by title or content..."
                    style={{ margin: 0, width: '100%', background: '#fff', borderRadius: '15px', boxShadow: 'var(--card-shadow)', padding: '15px 20px', border: 'none' }}
                  />
                </div>

                {/* Post Form Toggle */}
                {user && !user.isAnonymous && currentFilter === 'All' && (
                  <div style={{ marginBottom: '20px' }}>
                    {!showPostForm ? (
                      <button 
                        onClick={() => setShowPostForm(true)}
                        className="btn-primary" 
                        style={{ width: '100%', borderRadius: '15px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'var(--primary)', border: 'none', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                      >
                        <PlusCircle size={20} /> Create New Update / Post
                      </button>
                    ) : (
                      <PostForm addToast={addToast} onCancel={() => setShowPostForm(false)} currentUserProfile={userProfile} />
                    )}
                  </div>
                )}

                {/* Knowledge Repository Sub-Tabs */}
                {(currentFilter === 'Knowledge Repository' || currentFilter === 'G.Os Center' || currentFilter === 'Official SoPs' || currentFilter === 'Imp Files') && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px', background: '#f8fafc', padding: '10px', borderRadius: '15px', border: '1px solid #e2e8f0' }}>
                    <button 
                      className={`side-btn ${currentFilter === 'Knowledge Repository' ? 'active-tab' : ''}`} 
                      style={{ flex: 1, minWidth: '100px', fontSize: '13px', margin: 0, justifyContent: 'center' }}
                      onClick={() => setCurrentFilter('Knowledge Repository')}
                    >All Files</button>
                    <button 
                      className={`side-btn ${currentFilter === 'G.Os Center' ? 'active-tab' : ''}`} 
                      style={{ flex: 1, minWidth: '100px', fontSize: '13px', margin: 0, justifyContent: 'center' }}
                      onClick={() => setCurrentFilter('G.Os Center')}
                    >📜 G.Os Center</button>
                    <button 
                      className={`side-btn ${currentFilter === 'Official SoPs' ? 'active-tab' : ''}`} 
                      style={{ flex: 1, minWidth: '100px', fontSize: '13px', margin: 0, justifyContent: 'center' }}
                      onClick={() => setCurrentFilter('Official SoPs')}
                    >✅ Official SoPs</button>
                    <button 
                      className={`side-btn ${currentFilter === 'Imp Files' ? 'active-tab' : ''}`} 
                      style={{ flex: 1, minWidth: '100px', fontSize: '13px', margin: 0, justifyContent: 'center' }}
                      onClick={() => setCurrentFilter('Imp Files')}
                    >📁 Imp Files</button>
                  </div>
                )}

                {/* Feed */}
                <div id="postBox">
                  {filteredPosts.map(post => (
                    <PostCard
                      key={post.id}
                      post={post}
                      isExpanded={expandedPosts.has(post.id)}
                      toggleExpansion={() => togglePostExpansion(post.id)}
                      addToast={addToast}
                      isAdmin={isAdmin}
                    />
                  ))}
                  {filteredPosts.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '50px 20px', background: 'white', borderRadius: '20px', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.05)' }}>
                      <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 3 }}>
                        <LayoutDashboard size={48} color="#cbd5e1" style={{ marginBottom: '15px' }} />
                      </motion.div>
                      <h3 style={{ margin: '0 0 5px 0', fontSize: '18px', fontWeight: 800, color: '#64748b' }}>No Posts Found</h3>
                      <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                        {searchQuery ? `No matches for "${searchQuery}"` : `There are no posts for the "${currentFilter}" category yet.`}
                      </p>
                      {currentFilter === 'All' && posts.length > 0 && (
                        <p style={{ marginTop: '10px', fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>
                          Found {posts.length} total posts in database. Checking filters...
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {currentTab === 'chat' && <ChatSection messages={chatMessages} user={user} addToast={addToast} />}
            {currentTab === 'suggestions' && (
              <div className="section-card card-blue">
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary)', marginBottom: '15px' }}>💡 Suggestions</h2>
                <div id="suggestionBox" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                  {suggestions.length === 0 && <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No suggestions found.</p>}
                  {suggestions.map(s => (
                    <div key={s.id} style={{ padding: '15px', borderBottom: '1px solid #eee', fontSize: '14px', background: '#fff', marginBottom: '8px', borderRadius: '12px', borderLeft: '4px solid var(--accent)' }}>
                      <b>{s.name || 'User'}:</b> {s.text || (s as any).suggestion || (s as any).msg}
                    </div>
                  ))}
                </div>
                <div style={{ padding: '10px 0', borderTop: '1px solid #eee', marginTop: '10px' }}>
                  <a href="https://rakeshkumardhawan.github.io/e-vedhika/suggestion.html" target="_blank" rel="noreferrer" className="btn-primary" style={{ display: 'block', textAlign: 'center', background: 'var(--success)', textDecoration: 'none' }}>
                    More Suggestions →
                  </a>
                </div>
              </div>
            )}
            {currentTab === 'profile' && user && !user.isAnonymous && <ProfileSection user={user} profile={userProfile} allPosts={posts} addToast={addToast} />}
            {currentTab === 'workspace' && <DigitalWorkspaceSection addToast={addToast} />}
            {currentTab === 'repo' && <KnowledgeHubSection />}
          </AnimatePresence>
        </main>
      </div>
    </>
  );
}

function ProfileSection({ user, profile, allPosts, addToast }: { user: any, profile: UserProfile | null, allPosts: Post[], addToast: (s: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [myProblems, setMyProblems] = useState<ProblemReport[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'problems'), where('uid', '==', user.uid));
    return onSnapshot(q, (snap) => {
      const arr: ProblemReport[] = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() } as ProblemReport));
      arr.sort((a, b) => (b.time || 0) - (a.time || 0));
      setMyProblems(arr);
    }, (err) => console.error("My Problems Error:", err));
  }, [user]);

  const myPosts = allPosts.filter(p => p.uid === user?.uid);

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const form = e.target as any;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        username: form.username.value,
        village: form.village.value,
        office: form.office.value,
        bio: form.bio.value,
      });
      setEditing(false);
      addToast("Profile updated!");
    } catch { addToast("Failed to update profile"); }
  };

  if (!user || user.isAnonymous) return (
    <div className="section-card card-gold" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <User size={48} color="#ccc" style={{ margin: '0 auto 15px auto' }} />
      <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--primary)', marginBottom: '10px' }}>Login Required</h2>
      <p style={{ color: '#777', fontSize: '14px' }}>Please log in to your account to view your community profile.</p>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Profile Header */}
      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ height: '100px', background: 'var(--primary)', position: 'relative' }}>
          <div style={{ position: 'absolute', bottom: '-40px', left: '30px', width: '80px', height: '80px', background: 'var(--accent)', borderRadius: '20px', border: '4px solid white', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
            <User size={40} />
          </div>
        </div>
        <div style={{ padding: '50px 30px 25px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--primary)', margin: '0 0 5px 0' }}>{profile?.username || "Community Member"}</h2>
            <p style={{ color: '#777', fontSize: '14px', margin: 0, fontWeight: 500 }}>{profile?.office || "No Office Set"} • {profile?.village || "No Village"}</p>
          </div>
          <button 
            onClick={() => setEditing(!editing)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#f1f5f9', color: '#475569', borderRadius: '10px', fontWeight: 700, fontSize: '13px', border: 'none', cursor: 'pointer' }}
          >
            {editing ? <X size={14}/> : <Edit2 size={14}/>}
            {editing ? 'Cancel' : 'Edit Profile'}
          </button>
        </div>

        {editing ? (
          <form onSubmit={handleUpdate} style={{ padding: '0 30px 30px 30px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
              <div>
                <label style={{ fontSize: '10px', fontWeight: 800, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '5px' }}>Display Name</label>
                <input name="username" defaultValue={profile?.username} style={{ width: '100%', padding: '10px 15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', fontWeight: 600, fontSize: '14px', boxSizing: 'border-box' }} required />
              </div>
              <div>
                <label style={{ fontSize: '10px', fontWeight: 800, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '5px' }}>Village</label>
                <input name="village" defaultValue={profile?.village} style={{ width: '100%', padding: '10px 15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', fontWeight: 600, fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '10px', fontWeight: 800, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '5px' }}>Office/Position</label>
                <input name="office" defaultValue={profile?.office} style={{ width: '100%', padding: '10px 15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', fontWeight: 600, fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '10px', fontWeight: 800, color: '#999', textTransform: 'uppercase', letterSpacing: '1px', display: 'block', marginBottom: '5px' }}>Bio</label>
                <input name="bio" defaultValue={profile?.bio} style={{ width: '100%', padding: '10px 15px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', fontWeight: 600, fontSize: '14px', boxSizing: 'border-box' }} />
              </div>
            </div>
            <button style={{ width: '100%', background: 'var(--primary)', color: 'white', padding: '12px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', marginTop: '10px' }}>
              <Save size={18}/> Save Profile Information
            </button>
          </form>
        ) : (
          <div style={{ padding: '0 30px 30px 30px' }}>
            <p style={{ color: '#555', fontSize: '14px', fontStyle: 'italic', margin: 0 }}>{profile?.bio || "No biography added yet."}</p>
          </div>
        )}
      </div>

      {/* Stats and Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {/* Posts */}
        <div className="section-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'space-between', marginBottom: '15px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0, flex: 1 }}>
              <FileText color="var(--accent)" size={20}/> My Submitted Posts
            </h3>
            <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 800, color: '#64748b' }}>{myPosts.length}</span>
          </div>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {myPosts.map(p => (
              <div key={p.id} style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '10px' }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)', margin: '0 0 5px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#94a3b8' }}>
                  <span>{new Date(p.time).toLocaleDateString()}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>❤️ {p.likes}</span>
                    <span>👁️ {p.views}</span>
                  </div>
                </div>
              </div>
            ))}
            {myPosts.length === 0 && <p style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8', fontSize: '13px', margin: 0 }}>You haven't posted anything yet.</p>}
          </div>
        </div>

        {/* Problems */}
        <div className="section-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'space-between', marginBottom: '15px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0, flex: 1 }}>
              <AlertTriangle color="var(--danger)" size={20}/> My Reported Issues
            </h3>
            <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 800, color: '#64748b' }}>{myProblems.length}</span>
          </div>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {myProblems.map(p => (
              <div key={p.id} style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid rgba(220, 38, 38, 0.3)', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ padding: '2px 6px', color: 'white', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, borderRadius: '4px', background: p.status === 'solved' ? 'var(--success)' : 'var(--danger)' }}>
                    {p.status || 'pending'}
                  </span>
                  {p.category && (
                    <span style={{ padding: '2px 6px', background: 'var(--primary)', color: 'white', fontSize: '10px', fontWeight: 800, borderRadius: '4px' }}>
                      {p.category}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '13px', fontWeight: 500, color: '#475569', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.msg}</p>
                <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '8px' }}>{new Date(p.time).toLocaleDateString()}</div>
              </div>
            ))}
            {myProblems.length === 0 && <p style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8', fontSize: '13px', margin: 0 }}>No issues reported by you.</p>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MenuButton({ label, active, onClick, icon: Icon, color }: { label: React.ReactNode, active: boolean, onClick: () => void, icon?: any, color?: string }) {
  return (
    <button 
      className={`side-btn ${active ? 'active-tab' : ''}`} 
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', width: '100%', minHeight: '48px',
        border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: active ? 700 : 600,
        marginBottom: '4px'
      }}
    >
      {Icon && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px' }}>
          <Icon size={18} color={active ? 'var(--primary)' : (color || '#64748b')} />
        </div>
      )}
      <span style={{ flex: 1, textAlign: 'left', color: active ? 'var(--primary)' : '' }}>{label}</span>
    </button>
  );
}

function PostForm({ addToast, onCancel, postToEdit, currentUserProfile }: { addToast: (s: string) => void, onCancel?: () => void, postToEdit?: Post, currentUserProfile?: UserProfile | null }) {
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(postToEdit?.category || "General");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    
    setLoading(true);
    const form = e.target as any;
    const title = form.title.value;
    const currentCategory = form.category.value;
    const subCategory = form.subCategory?.value || "";
    const content = form.content.value;
    const file = form.media.files[0];

    let mediaUrl = postToEdit?.mediaUrl || "";
    let mediaType = postToEdit?.mediaType || "";

    if (file) {
      if (file.size > 600000) { 
        addToast("Error: File exceeds size limit (Max 600KB to ensure successful upload)");
        setLoading(false);
        return;
      }
      try {
        mediaUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.readAsDataURL(file);
        });
        mediaType = file.type;
      } catch (err) {
        console.error(err);
      }
    }

    try {
      const user = auth.currentUser;
      console.log("Submit attempt. User:", user ? user.uid : "NULL", "Anon:", user?.isAnonymous);
      
      if (postToEdit) {
        await updateDoc(publicDoc('posts', postToEdit.id), {
          title,
          content,
          category: currentCategory,
          subCategory,
          mediaUrl,
          mediaType,
        });
        addToast("Post updated!");
      } else {
        await addDoc(publicCol('posts'), {
          title,
          content,
          category: currentCategory,
          subCategory,
          mediaUrl,
          mediaType,
          likes: 0,
          likedBy: [],
          views: 0,
          comments: [],
          time: Date.now(),
          uid: auth.currentUser?.uid || "NO_UID",
          userName: currentUserProfile?.username || auth.currentUser?.email?.split('@')[0] || "Member"
        });
        addToast("Post published!");
      }
      form.reset();
      if (onCancel) onCancel();
    } catch (err: any) {
      const user = auth.currentUser;
      const debugInfo = ` (User: ${user ? (user.isAnonymous ? "Anon" : "Auth") : "None"})`;
      addToast("Failed: " + err.message + debugInfo);
      console.error("Submission error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="section-card card-gold post-form-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary)', margin: 0 }}>
          {postToEdit ? '✏️ Edit Post' : '✍️ Create New Post'}
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onCancel && (
            <button 
              type="button" 
              onClick={onCancel}
              style={{ background: '#fef2f2', color: 'var(--danger)', border: 'none', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gap: '20px', marginBottom: '20px' }} className="form-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', marginLeft: '5px' }}>Topic / Headline</label>
          <input 
            name="title" 
            defaultValue={postToEdit?.title}
            placeholder="What's the update about?" 
            style={{ width: '100%', padding: '14px 18px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '15px', fontWeight: 600, boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.2s' }}
            required 
            onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
          />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', marginLeft: '5px' }}>Category</label>
          <select 
            name="category" 
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ width: '100%', padding: '14px 18px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '15px', background: '#f8fafc', fontWeight: 600, boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }}
          >
          <option value="Announcement">📢 Announcement</option>
          <option value="Knowledge Repository">🏛️ Knowledge Repository</option>
          <option value="eGramSwaraj">🌾 e-GramSwaraj</option>
          <option value="Election">🗳️ Election</option>
          <option value="Emergency">⚠️ Emergency</option>
          <option value="Epanchayat Htax">🏠 H-Tax</option>
          <option value="General">📌 General</option>
          <option value="News">📰 News</option>
          <option value="PFMS">💰 PFMS</option>
        </select>
      </div>
    </div>

    {(category === "Knowledge Repository" || category === "Election") && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={{ marginBottom: '15px' }}>
          <select name="subCategory" defaultValue={postToEdit?.subCategory} style={{ width: '100%', padding: '12px 15px', borderRadius: '10px', border: `2px solid ${category === "Election" ? 'var(--danger)' : 'var(--primary)'}`, fontSize: '14px', background: category === "Election" ? '#fef2f2' : '#f0f9ff', color: category === "Election" ? 'var(--danger)' : 'var(--primary)', fontWeight: 800, boxSizing: 'border-box' }}>
            {category === "Knowledge Repository" ? (
              <>
                <option value="G.Os Center">🏛️ G.Os Center</option>
                <option value="Official SoPs">📄 Official SoPs</option>
                <option value="Imp Files">📁 Imp Files</option>
              </>
            ) : (
              <>
                <option value="GP">Gram Panchayat (GP)</option>
                <option value="MPTC">MPTC</option>
              </>
            )}
          </select>
        </motion.div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
        <label style={{ fontSize: '13px', fontWeight: 700, color: '#64748b', marginLeft: '5px' }}>Detailed Information</label>
        <textarea 
          name="content" 
          defaultValue={postToEdit?.content}
          rows={5} 
          placeholder="Share full details here... (Line breaks will be preserved)" 
          style={{ width: '100%', padding: '18px', borderRadius: '12px', border: '2px solid #e2e8f0', fontSize: '15px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.2s', lineHeight: '1.6' }}
          required 
          onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
          onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
        />
      </div>

      <div style={{ border: '2px dashed #ccc', padding: '20px', borderRadius: '12px', textAlign: 'center', background: '#fafafa', marginBottom: '15px', cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
        <input 
          ref={fileInputRef} 
          name="media" 
          type="file" 
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" 
          style={{ display: 'none' }} 
        />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', color: '#777' }}>
          <Camera size={30} color="var(--primary)" />
          <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px' }}>{postToEdit?.mediaUrl ? 'Replace Media' : 'Attach Photo/Video/Document'}</span>
          <span style={{ fontSize: '11px', color: '#aaa' }}>Max size: 600KB (Docs/Images/Videos)</span>
        </div>
      </div>

      <button 
        disabled={loading}
        className="btn-primary"
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
      >
        {loading ? (postToEdit ? 'Updating...' : 'Publishing...') : <><Send size={18}/> {postToEdit ? 'Save Changes' : 'Publish Update'}</>}
      </button>
    </form>
  );
}

function PostCard({ post, isExpanded, toggleExpansion, addToast, isAdmin = false }: { post: Post, isExpanded: boolean, toggleExpansion: () => void, addToast: (s: string) => void, isAdmin?: boolean }) {
  const [showComments, setShowComments] = useState(false);
  const [isPostByAdmin, setIsPostByAdmin] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    // Check if post author is admin
    const checkAdmin = async () => {
      if (!post.uid) {
        setIsPostByAdmin(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'admins', post.uid));
        setIsPostByAdmin(snap.exists());
      } catch (err) {
        console.error("Admin check error:", err);
      }
    };
    checkAdmin();
  }, [post.uid]);

  const handleLike = async () => {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
      addToast("Join to interact!");
      return;
    }
    
    // Check if already liked
    if (post.likedBy?.includes(user.uid)) {
      addToast("Already liked!");
      return;
    }

    try {
      await updateDoc(publicDoc('posts', post.id), { 
        likes: increment(1),
        likedBy: arrayUnion(user.uid)
      });
    } catch (err) { console.error(err); }
  };

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isDeleteLocked) {
      addToast("⛔ Deletion Expired: Posts can only be deleted within 24 hours of publishing.");
      return;
    }

    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      addToast("Click again to confirm deletion 🗑️");
      setTimeout(() => setIsConfirmingDelete(false), 3000);
      return;
    }

    try {
      console.log("Deleting post:", post.id);
      await deleteDoc(publicDoc('posts', post.id));
      addToast("Successfully deleted post!");
    } catch (err: any) {
      console.error("Critical Delete Error:", err);
      addToast("Delete Failed: " + err.message);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleAddComment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser || auth.currentUser.isAnonymous) return addToast("Join to comment");
    const input = (e.target as any).comment;
    if (!input.value.trim()) return;
    
    try {
      await updateDoc(publicDoc('posts', post.id), {
        comments: arrayUnion({
          user: auth.currentUser.email?.split('@')[0] || "Member",
          msg: input.value,
          time: Date.now()
        })
      });
      input.value = "";
      addToast("Comment added!");
    } catch (err) { console.error(err); }
  };

  const isOwner = auth.currentUser?.uid === post.uid || isAdmin;
  const isDeleteLocked = ((Date.now() - post.time) > (24 * 60 * 60 * 1000)) && !isAdmin;

  if (isEditing) {
    return (
      <div className="section-card">
        <PostForm postToEdit={post} addToast={addToast} onCancel={() => setIsEditing(false)} />
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="post-container" 
      style={{ padding: 0, overflow: 'hidden' }}
    >
      {post.mediaUrl && (
        <div className="post-media-container" style={{ borderRadius: 0, borderBottom: '1px solid #eee', marginBottom: 0 }}>
          {post.mediaType?.startsWith('video') ? (
            <video controls className="post-media" style={{ maxHeight: '500px', width: '100%' }}>
              <source src={post.mediaUrl} />
            </video>
          ) : post.mediaType?.startsWith('image/') ? (
            <img src={post.mediaUrl} className="post-media" style={{ maxHeight: '500px', width: '100%', objectFit: 'cover' }} alt={post.title} />
          ) : (
            <div style={{ padding: '20px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: 'var(--primary)', color: 'white', padding: '10px', borderRadius: '10px' }}>
                  <FileText size={24} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--primary)' }}>Attached Document</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>{post.mediaType?.split('/')[1]?.toUpperCase() || 'FILE'} Format</div>
                </div>
              </div>
              <a 
                href={post.mediaUrl} 
                download={post.title || "document"} 
                target="_blank" 
                rel="noreferrer"
                style={{ 
                  background: 'var(--success)', 
                  color: 'white', 
                  padding: '8px 15px', 
                  borderRadius: '10px', 
                  fontSize: '13px', 
                  fontWeight: 700, 
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Download size={16} /> Download
              </a>
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '20px' }}>
        <div className="post-header" style={{ marginBottom: '15px' }}>
          <div className="post-tags">
            <span className="post-tag" style={{ background: 'var(--primary)', color: 'white' }}>{post.category}</span>
            {post.subCategory && (
              <span className="post-tag" style={{ background: '#fef3c7', color: '#92400e' }}>
                {post.subCategory}
              </span>
            )}
            {isPostByAdmin && (
              <span className="post-tag" style={{ background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>
                ✓ Official
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>
              <Eye size={14} /> {post.views || 0}
            </div>
            {isOwner && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleEditClick} style={{ background: '#f1f5f9', border: 'none', padding: '8px', borderRadius: '8px', color: '#64748b', cursor: 'pointer' }}>
                  <Edit3 size={16} />
                </button>
                <button onClick={handleDelete} style={{ background: isConfirmingDelete ? '#fee2e2' : '#f1f5f9', border: 'none', padding: '8px', borderRadius: '8px', color: '#ef4444', cursor: 'pointer' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
        
        <h4 className="post-title" style={{ fontSize: '20px', marginBottom: '10px' }}>{post.title}</h4>
        
        <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <User size={12} /> Posted by <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{post.userName || "Admin"}</span> • {new Date(post.time).toLocaleDateString()}
        </div>

        <div className={`post-body ${isExpanded ? '' : 'line-clamp-3'}`} style={{ marginBottom: isExpanded ? '15px' : '5px' }}>
          {post.content}
        </div>

        {post.content && post.content.length > 200 && (
          <button 
            onClick={toggleExpansion} 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--primary)', 
              fontWeight: 800, 
              fontSize: '12px', 
              cursor: 'pointer', 
              padding: '5px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              textDecoration: 'underline'
            }}
          >
            {isExpanded ? <><ChevronUp size={14}/> Read Less</> : <><ChevronDown size={14}/> Read More</>}
          </button>
        )}

        <div className="post-footer" style={{ borderTop: '1px solid #f1f5f9', marginTop: '15px', paddingTop: '15px' }}>
          <div style={{ display: 'flex', gap: '20px' }}>
            <button onClick={handleLike} className="post-action-btn" style={{ padding: 0, color: post.likedBy?.includes(auth.currentUser?.uid || "") ? '#ef4444' : '#64748b' }}>
              <Heart size={20} fill={post.likedBy?.includes(auth.currentUser?.uid || "") ? '#ef4444' : 'none'} /> {post.likes || 0}
            </button>
            <button onClick={() => setShowComments(!showComments)} className="post-action-btn" style={{ padding: 0, color: '#0ea5e9' }}>
              <MessageCircle size={20} /> {(post.comments || []).length}
            </button>
          </div>
          <button 
            onClick={async () => {
              const u=window.location.origin+window.location.pathname+"?post="+post.id;
              if (navigator.share) {
                try {
                  await navigator.share({ title: 'E-Vedhika', text: post.title, url: u });
                } catch (err: any) {
                  if (err.name !== 'AbortError') { navigator.clipboard.writeText(u); addToast("Link copied!"); }
                }
              } else { navigator.clipboard.writeText(u); addToast("Link copied!"); }
            }} 
            className="post-action-btn" 
            style={{ padding: 0, color: '#16a34a' }}
          >
            <Share2 size={20} />
          </button>
        </div>

        <AnimatePresence>
          {showComments && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #f5f5f5', maxHeight: '250px', overflowY: 'auto' }}>
                {(post.comments || []).length === 0 && <p style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>No comments yet.</p>}
                {(post.comments || []).map((cm, idx) => (
                  <div key={idx} style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)' }}>{cm.user}</span>
                      <span style={{ fontSize: '10px', color: '#cbd5e1' }}>{new Date(cm.time).toLocaleDateString()}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>{cm.msg}</p>
                  </div>
                ))}
              </div>
              <form onSubmit={handleAddComment} style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
                <input name="comment" placeholder="Add a comment..." style={{ flex: 1, margin: 0, padding: '8px 12px', borderRadius: '8px', fontSize: '13px' }} />
                <button className="btn-primary" style={{ padding: '0 15px', height: '36px', fontSize: '12px' }}>Post</button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function ChatSection({ messages, user, addToast }: { messages: ChatMessage[], user: any, addToast: (s: string) => void }) {
  const [msg, setMsg] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!user || user.isAnonymous) return addToast("Join first!");
    if (!msg.trim()) return;
    try {
      await addDoc(publicCol('chat'), {
        msg,
        time: Date.now(),
        uid: user.uid
      });
      setMsg("");
    } catch (err: any) { addToast(err.message); }
  };

  return (
    <div className="section-card card-blue" style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
      <div style={{ padding: '15px', borderBottom: '1px solid #eee', fontWeight: 800, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <MessageCircle size={20} color="var(--info)" /> Community Live Chat
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', background: '#f8fafc' }}>
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.uid === user?.uid ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%', padding: '10px 15px', borderRadius: '15px', fontSize: '14px',
              background: m.uid === user?.uid ? 'var(--primary)' : '#fff',
              color: m.uid === user?.uid ? '#fff' : '#333',
              border: m.uid === user?.uid ? 'none' : '1px solid #ddd',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
            }}>
              {m.msg}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ padding: '15px', borderTop: '1px solid #eee', display: 'flex', gap: '10px', background: '#fff', borderRadius: '0 0 15px 15px' }}>
        <input 
          value={msg} 
          onChange={(e) => setMsg(e.target.value)} 
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Type your message..." 
          style={{ flex: 1, padding: '10px 15px', borderRadius: '10px', border: '1px solid #ccc', outline: 'none', fontSize: '14px' }} 
        />
        <button onClick={send} style={{ background: 'var(--primary)', color: 'white', padding: '10px 15px', borderRadius: '10px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

function ProblemSection({ addToast, user, globalProblems }: { addToast: (s:string) => void, user: any, globalProblems?: ProblemReport[] }) {
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  // We already fetch global problems at the top level
  const problems = globalProblems || [];

  const report = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || user.isAnonymous) return addToast("Join to report issues");
    setLoading(true);
    const form = e.target as any;
    const msg = form.problem.value;
    const category = form.category.value;
    
    if (!category || !msg) {
      addToast("Fill all fields");
      setLoading(false);
      return;
    }

    try {
      await addDoc(publicCol('problems'), { 
        msg, 
        category,
        status: 'pending',
        time: Date.now(), 
        uid: user.uid 
      });
      form.reset();
      addToast("Report submitted!");
    } catch { addToast("Failed to submit"); }
    finally { setLoading(false); }
  };

  const filteredProblems = problems.filter(p => filter === 'all' ? true : p.status === filter);

  return (
    <div className="section-card card-gold">
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary)', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AlertTriangle color="var(--danger)" /> 🚩 PROBLEMS
      </h2>
      <form onSubmit={report} style={{ marginBottom: '20px' }}>
        <select name="category" style={{ width: '100%', padding: '12px 15px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px', marginBottom: '10px', background: '#f9f9f9', fontWeight: 600 }}>
          <option value="">Select Category</option>
          <option value="Aadhar">Aadhar</option>
          <option value="EPFO">EPFO</option>
          <option value="Payments">Payments</option>
          <option value="House Tax">House Tax</option>
        </select>
        <textarea name="problem" placeholder="Describe your issue..." style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px', marginBottom: '10px', height: '100px', resize: 'vertical', fontFamily: 'inherit' }} required />
        <button disabled={loading} style={{ width: '100%', padding: '12px', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          {loading ? 'Posting...' : 'Post Problem'}
        </button>
      </form>
      
      <div style={{ marginBottom: '15px' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #eee', fontSize: '12px', fontWeight: 700, background: '#f8fafc' }}>
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="solved">Solved</option>
        </select>
      </div>

      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {filteredProblems.length === 0 && <p style={{ fontSize: '12px', color: '#999', textAlign: 'center', padding: '20px' }}>No problems</p>}
        {filteredProblems.map(p => (
          <div key={p.id} style={{ padding: '12px', background: '#f9fafb', borderRadius: '10px', borderLeft: '4px solid var(--danger)', marginBottom: '10px', fontSize: '13px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ padding: '3px 6px', background: p.status === 'solved' ? 'var(--success)' : 'var(--danger)', color: 'white', borderRadius: '4px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase' }}>
                {p.status || 'pending'}
              </span>
              {p.category && (
                <span style={{ padding: '3px 6px', background: 'var(--primary)', color: 'white', borderRadius: '4px', fontSize: '10px', fontWeight: 800 }}>
                  {p.category}
                </span>
              )}
            </div>
            <p style={{ color: '#333', margin: '4px 0 0 0', lineHeight: 1.4 }}>{p.msg}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestSection({ requests, addToast, user }: { requests: RequestData[], addToast: (s:string) => void, user: any }) {
  const [loading, setLoading] = useState(false);

  const request = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || user.isAnonymous) return addToast("Login Required");
    setLoading(true);
    const form = e.target as any;
    const msg = form.msg.value;
    
    if (!msg) {
      addToast("Fill missing fields");
      setLoading(false);
      return;
    }

    try {
      await addDoc(publicCol('requests'), { 
        msg, 
        time: Date.now(), 
        uid: user.uid 
      });
      form.reset();
      addToast("Request sent!");
    } catch { addToast("Failed to send"); }
    finally { setLoading(false); }
  };

  return (
    <div className="section-card card-blue">
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary)', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <MessageCircle color="var(--info)" /> 📨 REQUEST
      </h2>
      <form onSubmit={request} style={{ marginBottom: '20px' }}>
        <textarea name="msg" placeholder="Describe your request..." style={{ width: '100%', padding: '15px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px', marginBottom: '10px', height: '100px', resize: 'vertical', fontFamily: 'inherit' }} required />
        <button disabled={loading} style={{ width: '100%', padding: '12px', background: 'var(--info)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Send size={18} /> {loading ? 'Sending...' : 'Send Request'}
        </button>
      </form>

      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {requests.length === 0 && <p style={{ fontSize: '12px', color: '#999', textAlign: 'center', padding: '20px' }}>No requests</p>}
        {requests.map(r => (
          <div key={r.id} style={{ padding: '12px', background: '#f8fafc', borderRadius: '10px', borderLeft: '4px solid var(--info)', marginBottom: '10px', fontSize: '13px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <p style={{ color: '#333', margin: '0 0 8px 0', lineHeight: 1.4 }}>{r.msg}</p>
            <div style={{ fontSize: '10px', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>{new Date(r.time).toLocaleDateString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeHubSection() {
  const [search, setSearch] = useState("");
  
  const sections = [
    {
      part: "PART-I: Preliminary",
      chapters: [
        {
          title: "Section 1 & 2: Base Rules & Definitions",
          content: (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div><strong>Extends to:</strong> Telangana mothaniki varthisthundi, municipal areas thappinchi.</div></div>
              <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', fontSize: '12px', border: '1px solid #e2e8f0' }}>
                <strong>Key Terms:</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '8px', listStyleType: 'disc' }}>
                   <li><strong>Gram Kantam:</strong> Traditionally inhabited areas.</li>
                   <li><strong>Electoral Roll:</strong> Assembly voter list base chesukoni tayaaru chestaru.</li>
                </ul>
              </div>
            </>
          )
        }
      ]
    },
    {
      part: "PART-II: GRAM PANCHAYAT",
      chapters: [
        {
          title: "Section 6: Gram Sabha Deep Dive",
          content: (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div><strong>Frequency:</strong> Every 2 months meeting. Meeting ki 7 days mundu notice ivvali.</div></div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div><strong>Quorum:</strong> 10% of voters or 50 voters (whichever is less).</div></div>
            </>
          )
        },
        {
          title: "Section 32: Sarpanch Executive Powers",
          content: (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div>GP Resolutions ni implement cheyali. <strong>Sanitation</strong> maintenance priority.</div></div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div>Protected water supply monitoring and Haritha Haram supervision.</div></div>
            </>
          )
        },
        {
          title: "Section 43: Panchayat Secretary Badhyathalu",
          content: (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div><strong>Attendance:</strong> 10 AM to 5 PM office lo undali.</div></div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div>Every month <strong>85% survival of plants</strong> record chupali.</div></div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}><div className="point-dot"></div><div>100% Tax collection responsibility and record maintenance.</div></div>
            </>
          )
        }
      ]
    },
    {
      part: "PART-III & IV: MANDAL & ZILLA PARISHAD",
      chapters: [
        {
          title: "Mandal Parishad (Sec 142-160)",
          content: "MPP President, VP and Members elections procedures. Agriculture and Health monitoring powers at Mandal level."
        },
        {
          title: "Zilla Parishad (Sec 172-190)",
          content: "ZP Chairperson election and powers. Oversight of Mandal and Gram Panchayats."
        }
      ]
    },
    {
      part: "PART-VIII: Penalties & Rules",
      chapters: [
        {
          title: "Section 287: Penalties (Point-to-Point)",
          content: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="point-dot"></div>
                <div>General Fine: ₹5,000 <span className="badge-rule">STRICT</span></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="point-dot"></div>
                <div>Littering on roads: ₹500 spot fine.</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="point-dot"></div>
                <div>Illegal Water Connection: Up to ₹5,000 fine and disconnection.</div>
              </div>
            </div>
          )
        }
      ]
    }
  ];

  const filtered = sections.filter(p => 
    p.part.toLowerCase().includes(search.toLowerCase()) || 
    p.chapters.some(c => c.title.toLowerCase().includes(search.toLowerCase()) || (typeof c.content === 'string' ? c.content.toLowerCase().includes(search.toLowerCase()) : false))
  );

  return (
    <div className="section-card" style={{ padding: 0 }}>
      <div className="book-cover">
        <h2 style={{ margin: 0, fontFamily: 'Righteous', fontSize: '22px' }}>TPRA 2018 DIGITAL GUIDE</h2>
        <p style={{ margin: '5px 0 0 0', fontSize: '11px', opacity: 0.8 }}>Inch-to-Inch Digital Handbook</p>
      </div>
      <div className="book-spine">
        <div style={{ marginBottom: '20px' }}>
          <input 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Search sections (eg: Sarpanch, Fine, PS)..."
            style={{ margin: 0, borderRadius: '20px', border: '2px solid var(--primary)' }}
          />
        </div>
        {filtered.map((p, idx) => (
          <details key={idx} className="book-part" open={search.length > 0}>
            <summary>{p.part}</summary>
            <div className="book-part-content">
              {p.chapters.map((c, cIdx) => (
                <details key={cIdx} className="book-section" open={search.length > 0}>
                  <summary>{c.title}</summary>
                  <div className="book-full-text">
                    {c.content}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
        {filtered.length === 0 && <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No sections found matching your search.</p>}
      </div>
    </div>
  );
}

function DigitalWorkspaceSection({ addToast }: { addToast: (s:string) => void }) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [showTrainingBot, setShowTrainingBot] = useState(false);

  const tools = [
    { id: 'dsr', title: 'DSR Analyzer', icon: BarChart3, desc: 'Analyze Daily Status Reports' },
    { id: 'multiday', title: 'Multi-Day attendance', icon: Layers, desc: 'Multiple Attendance Records' },
    { id: 'training', title: 'Digital Training', icon: GraduationCap, desc: 'Workflows & Tutorials' },
    { id: 'pract', title: 'PR Act Hub', icon: Book, desc: 'A to Z Interactive Guide' }
  ];

  return (
    <div className="section-card card-blue">
      <motion.h2 
        initial={{ x: -10, opacity: 0 }} 
        animate={{ x: 0, opacity: 1 }}
        style={{ fontSize: '20px', fontWeight: 800, color: 'var(--primary)', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <LayoutDashboard size={24} style={{ color: '#0891b2' }} /> Mana Panchayath
      </motion.h2>
      <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '20px' }}>Advanced tools for PR & RD Officers.</p>

      <div className="mana-grid">
        {tools.map(t => (
          <div key={t.id} className="mana-card" onClick={() => setActiveTool(t.id)}>
            <div style={{ color: 'var(--primary)', marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
              <t.icon size={32} />
            </div>
            <h4>{t.title}</h4>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {activeTool === 'dsr' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: '20px', borderTop: '2px dashed #e2e8f0', paddingTop: '20px' }}>
            <DSRAnalyzer addToast={addToast} />
          </motion.div>
        )}
        {activeTool === 'multiday' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: '20px', borderTop: '2px dashed #e2e8f0', paddingTop: '20px' }}>
            <MultiDayAnalyzer addToast={addToast} />
          </motion.div>
        )}
        {activeTool === 'training' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: '20px', borderTop: '2px dashed #e2e8f0', paddingTop: '20px' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}><GraduationCap /> Digital Workflows</h3>
                <button onClick={() => setShowTrainingBot(!showTrainingBot)} style={{ background: '#f1f5f9', border: 'none', padding: '5px 12px', borderRadius: '15px', color: 'var(--primary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Bot size={14} /> {showTrainingBot ? "Hide Help" : "Ask Training Bot"}
                </button>
             </div>

             <AnimatePresence>
                {showTrainingBot && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} style={{ marginBottom: '20px' }}>
                    <SmartAssistant 
                      title="Training Helper"
                      placeholder="How do I process a DSR? What is the login workflow?"
                      systemInstruction="You are a helpful training assistant for the Mana Panchayath workspace. You help users understand workflows like DSR Analysis (uploading .xls files, viewing charts) and Digital Training steps. Keep answers short and instructional."
                      icon={GraduationCap}
                    />
                  </motion.div>
                )}
             </AnimatePresence>

             <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {[1, 2, 3].map(step => (
                  <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <div style={{ width: '40px', height: '40px', background: 'var(--primary)', color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800' }}>{step}</div>
                    <div style={{ flex: 1, background: '#f8fafc', padding: '15px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontWeight: 700 }}>Workflow Step {step}</span>
                      <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>Detailed tutorial content for step {step} will appear here.</p>
                    </div>
                  </div>
                ))}
             </div>
          </motion.div>
        )}
        {activeTool === 'pract' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden', marginTop: '20px', borderTop: '2px dashed #e2e8f0', paddingTop: '20px' }}>
            <PRActHub />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusCell({ status, color }: { status: string, color: string }) {
  const [expanded, setExpanded] = useState(false);
  const fullText = status === 'P' ? 'Present' : status === 'A' ? 'Absent' : status === 'L' ? 'Leave' : status === 'T' ? 'Training' : status === 'M' ? 'Meeting' : '';
  
  return (
    <span 
      onClick={() => setExpanded(!expanded)}
      title={fullText}
      style={{ 
        display: 'inline-block', 
        padding: expanded && fullText ? '0 8px' : '0',
        width: expanded && fullText ? 'auto' : '24px', 
        height: '24px', 
        lineHeight: '24px', 
        borderRadius: '6px', 
        background: `${color}15`, 
        color: color, 
        fontWeight: 800, 
        fontSize: '11px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        whiteSpace: 'nowrap'
      }}>
      {expanded && fullText ? fullText : status}
    </span>
  );
}

function MultiDayAnalyzer({ addToast }: { addToast: (s:string) => void }) {
  const [aggregatedData, setAggregatedData] = useState<Map<string, { mandal: string, attendance: Record<string, string> }>>(new Map());
  const [allDates, setAllDates] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [debugLines, setDebugLines] = useState<any[][] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [mandalFilter, setMandalFilter] = useState('All');

  const analyzeFiles = async (files: FileList) => {
    setIsAnalyzing(true);
    setDebugLines(null);
    const newAggregated = new Map<string, { mandal: string, attendance: Record<string, string> }>();
    const datesFound = new Set<string>();

    try {
      for (const file of Array.from(files)) {
        // 1. Better Date Extraction
        let fileDateMatch = file.name.match(/\d{2}-\d{2}-\d{4}/) || 
                       file.name.match(/\d{4}-\d{2}-\d{2}/) || 
                       file.name.match(/\d{2}\.\d{2}\.\d{4}/) ||
                       file.name.match(/\d{2}-[a-zA-Z]{3}-\d{4}/i) ||
                       file.name.match(/\d{2}\s[a-zA-Z]{3}\s\d{4}/i) ||
                       file.name.match(/\d{2}\/\d{2}\/\d{4}/);
        let fileDate = fileDateMatch ? fileDateMatch[0].replace(/[\.\s\/]/g, '-') : null;
        
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        let workbooksData: any[][] = [];
        
        let isParsedValidly = false;
        try {
          const wb = XLSX.read(data, { type: 'array' });
          wb.SheetNames.forEach(sheetName => {
            const sheetData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' }) as any[][];
            const hasDataRow = sheetData.some(r => r.length > 1);
            if (sheetData.length > 2 && hasDataRow) {
                workbooksData.push(...sheetData.map(row => ({ row, sheetName } as any)));
                isParsedValidly = true;
            }
          });
        } catch (err) {
          console.warn("XLSX parsing failed", err);
        }

        if (!isParsedValidly) {
          // Fallback to HTML if XLSX fails or returns garbage
          try {
            const text = new TextDecoder('utf-8').decode(data);
            if (text.includes('<table') || text.includes('<TABLE') || text.includes('<html')) {
              workbooksData = [];
              const doc = new DOMParser().parseFromString(text, 'text/html');
              doc.querySelectorAll('tr').forEach(tr => {
                const row: any[] = [];
                tr.querySelectorAll('th, td').forEach(c => row.push((c as any).innerText?.trim() || c.textContent?.trim() || ''));
                if (row.length > 1) workbooksData.push({ row, sheetName: 'HTML' } as any);
              });
            }
          } catch (e) {
            console.warn('HTML fallback failed', e);
          }
        }

        if (workbooksData.length < 2) continue;

        // Extract raw rows
        const rows = workbooksData.map((item: any) => item.row);
        setDebugLines(rows.slice(0, 30)); // Keep first 30 rows for debugging

        // 3. Robust Date Detection in Content (if not in filename)
        if (!fileDate) {
          for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const rowStr = safeStringify(rows[i]);
            const match = rowStr.match(/\d{2}-\d{2}-\d{4}/) || rowStr.match(/\d{4}-\d{2}-\d{2}/) || rowStr.match(/\d{2}\.\d{2}\.\d{4}/) || rowStr.match(/\d{2}-[a-zA-Z]{3}-\d{4}/i) || rowStr.match(/\d{2}\/\d{2}\/\d{4}/) || rowStr.match(/\d{2}\s[a-zA-Z]{3}\s\d{4}/i);
            if (match) {
              fileDate = match[0].replace(/[\.\s\/]/g, '-');
              break;
            }
          }
        }
        if (!fileDate) {
          fileDate = new Date(file.lastModified).toLocaleDateString('en-GB').replace(/\//g, '-');
          if (datesFound.has(fileDate)) {
             fileDate = `${fileDate} (${file.name.substring(0, 8)})`;
          }
        }
        datesFound.add(fileDate);

        // 4. IMPROVED: Dynamic Column Detection Strategy
        let gpCol = -1;
        let mandalCol = -1;
        let statusCol = -1;
        let startRow = -1;

        // 4.a Find the most dense row (likely the true header row)
        let bestHeaderRowIdx = 0;
        let maxNonEmpty = 0;
        for (let r = 0; r < Math.min(rows.length, 50); r++) {
           if (!rows[r] || !Array.isArray(rows[r])) continue;
           const nonEmptyCount = rows[r].filter((c: any) => cleanStringData(c).length > 0).length;
           if (nonEmptyCount > maxNonEmpty) {
               maxNonEmpty = nonEmptyCount;
               bestHeaderRowIdx = r;
           }
        }

        // 4.b Look specifically in that dense header row first
        const headerRow = rows[bestHeaderRowIdx] || [];
        for (let c = 0; c < headerRow.length; c++) {
            const cellVal = cleanStringData(headerRow[c]).toLowerCase();
            if (gpCol === -1 && (cellVal.includes('gram') || cellVal === 'gp' || cellVal.includes('panchayat') || cellVal.includes('panchyat') || cellVal.includes('habitation') || cellVal.includes('village name') || cellVal === 'name of the gp')) {
              if (!cellVal.includes('code') && !cellVal.includes('id') && !cellVal.includes('lgd')) gpCol = c;
            }
            if (mandalCol === -1 && (cellVal.includes('mandal') || cellVal.includes('block') || cellVal.includes('tehsil'))) {
              if (!cellVal.includes('code') && !cellVal.includes('id') && !cellVal.includes('lgd')) mandalCol = c;
            }
            if (statusCol === -1 && (cellVal.includes('status') || cellVal.includes('attend') || cellVal.includes('uploaded') || cellVal.includes('dsr') || cellVal.includes('done') || cellVal.includes('worked'))) {
              if (!cellVal.includes('date') && !cellVal.includes('time') && !cellVal.includes('datetime')) statusCol = c;
            }
        }

        // 4.c Find startRow (first row after header that looks like data)
        for (let r = bestHeaderRowIdx + 1; r < Math.min(rows.length, 100); r++) {
            const row = rows[r];
            if (!row || !Array.isArray(row) || row.length < 2) continue;
            const rowStr = row.map((c: any) => cleanStringData(c)).join(' ');
            if (row.length > 4 && (/^\s*1\s+/.test(rowStr) || cleanStringData(row[0]) === '1' || cleanStringData(row[1]) === '1')) {
               startRow = r;
               break;
            }
        }
        if (startRow === -1) startRow = bestHeaderRowIdx + 1;

        // SECONDARY SCAN: If still missing GP or Status, check data distribution
        if (gpCol === -1 || statusCol === -1) {
           for (let c = 0; c < 20; c++) {
             let textCount = 0;
             let flagCount = 0;
             let numCount = 0;
             
             const scanEnd = Math.min(rows.length, 50);
             for(let r = 0; r < scanEnd; r++) {
                const val = cleanStringData(rows[r]?.[c]).toLowerCase();
                if (!val) continue;
                if (/^(p|a|yes|no|uploaded|pending|present|absent)$/.test(val)) flagCount++;
                if (val.length > 5 && /[a-z]/.test(val) && !/\d/.test(val)) textCount++;
                if (/^\d+$/.test(val)) numCount++;
             }
             
             if (statusCol === -1 && flagCount > 3) statusCol = c;
             if (gpCol === -1 && textCount > 5 && numCount < 2 && c > 0) gpCol = c;
           }
        }

        // FALLBACKS
        if (gpCol === -1) gpCol = 2; 
        if (statusCol === -1) statusCol = rows[0]?.length - 1 || 5;
        if (startRow === -1) {
           // Find first row with a lot of data
           startRow = rows.findIndex(r => r && r.filter((cell:any) => cleanStringData(cell).length > 0).length > 4);
           if (startRow === -1) startRow = 1;
        }

        // 5. Data Extraction
        let extractedCountForFile = 0;
        for (let i = startRow; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;
          
          const gp = cleanStringData(row[gpCol]);
          // Filter out header re-entries or empty rows
          if (!gp || gp.length < 2 || /^\d+$/.test(gp) || gp.toLowerCase().includes('total') || gp.toLowerCase().includes('report') || gp.toLowerCase().includes('page')) continue;

          const mandal = mandalCol !== -1 ? cleanStringData(row[mandalCol]) : '';
          const rawStatus = cleanStringData(row[statusCol]).toLowerCase();

          let symbol = "-";
          if (rawStatus.includes('present') || rawStatus === 'p' || rawStatus.includes('upload') || rawStatus === 'yes' || rawStatus.includes('on time') || rawStatus === 'done' || rawStatus === 'uploaded') symbol = "P";
          else if (rawStatus.includes('absent') || rawStatus === 'a' || rawStatus === 'no' || rawStatus.includes('not') || rawStatus.includes('pending') || rawStatus.includes('late')) symbol = "A";
          else if (rawStatus === 'l' || rawStatus.includes('leave')) symbol = "L";
          else if (rawStatus === 't' || rawStatus.includes('training')) symbol = "T";
          else if (rawStatus === 'm' || rawStatus.includes('meeting')) symbol = "M";

          if (symbol !== "-" || /^[palmt]$/.test(rawStatus)) {
            if (!newAggregated.has(gp)) {
              newAggregated.set(gp, { mandal, attendance: {} });
            }
            newAggregated.get(gp)!.attendance[fileDate] = symbol;
            extractedCountForFile++;
          }
        }

        // 6. Aggressive Fallback Extraction (If structured extraction failed for this file)
        if (extractedCountForFile === 0) {
           for (let i = 0; i < rows.length; i++) {
             const row = rows[i];
             if (!row || !Array.isArray(row)) continue;
             
             let statusSymbol = '';
             let possibleGp = '';
             let possibleMandal = '';
             
             // First, find the status cell
             let statusIndex = -1;
             for (let j = row.length - 1; j >= 0; j--) {
               const val = cleanStringData(row[j]).toLowerCase();
               if (!val) continue;
               
               if (/^(p|present|yes|uploaded|done|on time|attended|submitted|y)$/.test(val)) {
                 statusSymbol = 'P'; statusIndex = j; break;
               }
               else if (/^(a|absent|no|not upload|pending|late|not submitted|n)$/.test(val) || val.includes('not upload') || val.includes('not')) {
                 statusSymbol = 'A'; statusIndex = j; break;
               }
             }

             // If a status is found, scan backwards to find text fields for GP and Mandal
             if (statusSymbol && statusIndex > 0) {
               const textCells = [];
               for (let j = 0; j < statusIndex; j++) {
                 const val = cleanStringData(row[j]);
                 // Take strings that have letters, aren't just numbers, and aren't common headers
                 if (val.length >= 3 && /[a-zA-Z]/.test(val) && !/^\d+$/.test(val)) {
                   const lowerVal = val.toLowerCase();
                   if (!/^(total|page|report|present|absent|yes|no|status|attend|mandal|gram|village|s\.no|district)/.test(lowerVal)) {
                     textCells.push(val);
                   }
                 }
               }
               
               // Usually Mandal is before GP, so GP is the last text cell before Status, Mandal is before that
               // In some cases GP is the ONLY text column.
               if (textCells.length > 0) {
                 possibleGp = textCells[textCells.length - 1]; // The one closest to status
               }
               if (textCells.length > 1) {
                 possibleMandal = textCells[textCells.length - 2]; 
               }
             }
             
             if (statusSymbol && possibleGp.length > 2) {
               const cleanGp = possibleGp.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
               if (cleanGp.length < 3 || /^\d+$/.test(cleanGp)) continue;
               if (!newAggregated.has(cleanGp)) {
                 newAggregated.set(cleanGp, { mandal: possibleMandal, attendance: {} });
               }
               newAggregated.get(cleanGp)!.attendance[fileDate] = statusSymbol;
             }
           }
        }
      }

      const finalMap = new Map(newAggregated);
      setAggregatedData(finalMap);
      setAllDates(Array.from(datesFound).sort((a, b) => {
        const p = (s: string) => {
          const cleanDateStr = s.split(' ')[0] || '';
          const parts = cleanDateStr.split(/[-.]/);
          if (parts[2]?.length === 4) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
          if (parts[0]?.length === 4) return new Date(`${parts[0]}-${parts[1]}-${parts[2]}`).getTime();
          return 0;
        };
        return p(a) - p(b);
      }));

      if (finalMap.size === 0) {
        addToast("⚠️ Analysis completed but no GP-level attendance records were identified. Please check the file format.");
      } else {
        addToast(`✅ Parsed ${datesFound.size} out of ${files.length} reports! Found ${finalMap.size} GPs across ${datesFound.size} dates.`);
      }
    } catch (err) {
      addToast("❌ Error processing files. Ensure they are valid Excel/HTML reports.");
      console.error(err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const mandals = Array.from(new Set(Array.from(aggregatedData.values()).map(i => i.mandal || 'Unknown'))).filter(Boolean).sort();
  const filteredData = Array.from(aggregatedData.entries()).filter(([gp, info]) => {
    const matchesSearch = gp.toLowerCase().includes(searchTerm.toLowerCase()) || (info.mandal || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesMandal = mandalFilter === 'All' || (info.mandal || 'Unknown') === mandalFilter;
    return matchesSearch && matchesMandal;
  });

  const mandalSummary = Array.from(aggregatedData.entries()).reduce((acc, [gp, info]) => {
    const m = info.mandal || 'Unknown';
    if (!acc[m]) acc[m] = { totalGPs: 0, dates: {} as Record<string, { present: number, absent: number, total: number }> };
    acc[m].totalGPs++;
    allDates.forEach(date => {
      const status = info.attendance[date];
      if (!acc[m].dates[date]) acc[m].dates[date] = { present: 0, absent: 0, total: 0 };
      if (status) {
         acc[m].dates[date].total++;
         if (status === 'P') acc[m].dates[date].present++;
         else if (status === 'A') acc[m].dates[date].absent++;
      }
    });
    return acc;
  }, {} as Record<string, { totalGPs: number, dates: Record<string, { present: number, absent: number, total: number }> }>);

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{ color: 'var(--primary)', fontWeight: 800, margin: 0 }}>📅 Multi-Day Attendance Analyzer</h3>
          <p style={{ fontSize: '12px', color: '#64748b' }}>Select multiple daily reports to see a comparative view.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {aggregatedData.size > 0 && (
            <button 
              onClick={() => { setAggregatedData(new Map()); setAllDates([]); }}
              style={{ background: '#fee2e2', color: '#ef4444', border: 'none', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
            >
              Clear All
            </button>
          )}
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
            style={{ background: 'var(--primary)', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {isAnalyzing ? <RefreshCw className="animate-spin" size={18} /> : <Upload size={18} />}
            {aggregatedData.size > 0 ? "Add More Files" : "Upload Multiple Files"}
          </button>
        </div>
        <input 
          type="file" 
          multiple 
          ref={fileInputRef} 
          hidden 
          onChange={(e) => e.target.files && analyzeFiles(e.target.files)} 
        />
      </div>

      {aggregatedData.size === 0 && !isAnalyzing && (
        <div style={{ textAlign: 'center', padding: '50px 20px', background: '#f8fafc', borderRadius: '20px', border: '2px dashed #e2e8f0' }}>
          <Layers size={48} color="#cbd5e1" style={{ marginBottom: '15px' }} />
          <h4 style={{ color: '#64748b', margin: '0 0 5px 0' }}>No reports analyzed yet</h4>
          <p style={{ fontSize: '12px', color: '#94a3b8', maxWidth: '300px', margin: '0 auto' }}>
            Upload multiple PRAct daily reports to see attendance trends across different dates.
          </p>
        </div>
      )}

      {debugLines && debugLines.length > 0 && aggregatedData.size === 0 && (
        <div style={{ marginTop: '20px', padding: '15px', background: '#f1f5f9', borderRadius: '15px', border: '1px solid #cbd5e1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, color: '#475569', fontSize: '14px' }}>🔍 Parser Debug Preview (First 15 rows of last file)</h4>
            <button onClick={() => setDebugLines(null)} style={{ background: '#cbd5e1', border: 'none', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', color: '#475569', fontSize: '11px' }}>Close</button>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '350px' }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '11px', background: 'white' }}>
              <thead>
                <tr>
                  {debugLines[0]?.map((_, i) => <th key={i} style={{ border: '1px solid #e2e8f0', padding: '4px', background: '#f8fafc' }}>Col {i}</th>)}
                </tr>
              </thead>
              <tbody>
                {debugLines.slice(0, 15).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => <td key={j} style={{ border: '1px solid #e2e8f0', padding: '4px', whiteSpace: 'nowrap' }}>{String(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '11px', color: '#64748b', marginTop: '10px' }}>
            If your data is visible above but the table doesn't show entries, it means the parser couldn't identify "GP Name" or "Status" columns.
          </p>
        </div>
      )}

      {aggregatedData.size > 0 && (
        <div style={{ marginBottom: '20px' }}>
          
          <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
             <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '5px' }}>Filter by Mandal</label>
                <select 
                  value={mandalFilter} 
                  onChange={e => setMandalFilter(e.target.value)}
                  style={{ width: '100%', padding: '10px 15px', borderRadius: '10px', border: '1px solid #cbd5e1', outline: 'none' }}
                >
                  <option value="All">All Mandals</option>
                  {mandals.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
             </div>
             <div style={{ flex: 2, minWidth: '200px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '5px' }}>Search GP or Mandal</label>
                <input 
                  type="text" 
                  placeholder="Search GP name..." 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ width: '100%', padding: '10px 15px', borderRadius: '10px', border: '1px solid #cbd5e1', outline: 'none' }}
                />
             </div>
          </div>

          <div style={{ marginBottom: '25px', background: '#f8fafc', padding: '15px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#334155', fontSize: '14px' }}>Mandal Summary (Total Present %)</h4>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', color: '#64748b' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Mandal</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>Total GPs</th>
                    {allDates.map(date => (
                      <th key={date} style={{ padding: '8px', textAlign: 'center' }}>{date}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(mandalSummary).filter(([m]) => mandalFilter === 'All' || m === mandalFilter).map(([mandal, { totalGPs, dates }]) => (
                    <tr key={mandal} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px', fontWeight: 600, color: '#334155' }}>{mandal}</td>
                      <td style={{ padding: '8px', textAlign: 'center', color: '#64748b' }}>{totalGPs}</td>
                      {allDates.map(date => {
                        const { present, total } = dates[date] || { present: 0, total: 0 };
                        const pct = total > 0 ? Math.round((present / totalGPs) * 100) : 0;
                        const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#ef4444';
                        return (
                          <td key={date} style={{ padding: '8px', textAlign: 'center' }}>
                            <div style={{ color: color, fontWeight: 700 }}>{pct}%</div>
                            <div style={{ fontSize: '10px', color: '#94a3b8' }}>{present}/{totalGPs}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        <div style={{ overflowX: 'auto', background: 'white', borderRadius: '15px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '12px', textAlign: 'left', color: '#64748b' }}>Mandal</th>
                <th style={{ padding: '12px', textAlign: 'left', color: '#64748b' }}>Gram Panchayat</th>
                {allDates.map(d => (
                  <th key={d} style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '11px', minWidth: '80px' }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.map(([gp, info], idx) => (
                <tr key={gp} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#fcfdfe' }}>
                  <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '12px' }}>{info.mandal}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--primary)' }}>{gp}</td>
                  {allDates.map(date => {
                    const status = info.attendance[date] || '-';
                    const color = status === 'P' ? '#16a34a' : status === 'A' ? '#ef4444' : status === 'L' ? '#64748b' : status === 'T' ? '#a16207' : status === 'M' ? '#0891b2' : '#cbd5e1';
                    return (
                      <td key={date} style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <StatusCell status={status} color={color} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {aggregatedData.size === 0 && !isAnalyzing && (
        <div style={{ textAlign: 'center', padding: '60px', background: '#f8fafc', borderRadius: '20px', border: '2px dashed #e2e8f0' }}>
          <Layers size={48} color="#cbd5e1" style={{ marginBottom: '15px' }} />
          <p style={{ color: '#64748b', fontWeight: 600 }}>Select daily report files to build the multi-day grid.</p>
          <p style={{ color: '#94a3b8', fontSize: '12px' }}>You can select 2 or more files from your phone/PC.</p>
        </div>
      )}
    </div>
  );
}

function DSRAnalyzer({ addToast }: { addToast: (s:string) => void }) {
  const [stats, setStats] = useState({ total: 0, done: 0, pending: 0, late: 0, onTime: 0, present: 0, absent: 0, leave: 0, training: 0, meeting: 0, date: '' });
  const [reportData, setReportData] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [attendanceFilter, setAttendanceFilter] = useState('All');
  const [dsrFilter, setDsrFilter] = useState('All');
  const [params, setParams] = useState({ district: '', mandal: '', date: new Date().toISOString().split('T')[0] });
  const [perfData, setPerfData] = useState([
    { name: 'On Time', value: 0, color: '#10b981' },
    { name: 'Late', value: 0, color: '#f59e0b' },
    { name: 'Pending', value: 0, color: '#ef4444' }
  ]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      processFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'xls' || ext === 'xlsx') {
        setSelectedFile(file);
        processFile(file);
      } else {
        addToast("Please upload Excel files only (.xls, .xlsx)");
      }
    }
  };

  const processFile = (file: File) => {
    setIsAnalyzing(true);
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = (evt) => {
      try {
        const arrayBuffer = evt.target?.result as ArrayBuffer;
        let jsonData: any[] = [];
        const data = new Uint8Array(arrayBuffer);
        
        try {
          // Attempt standard XLSX library parsing first (handles real .xlsx, .xls, and many HTML variants)
          const wb = XLSX.read(data, { type: 'array' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          jsonData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        } catch (err) {
          console.warn("XLSX lib parsing failed", err);
        }
        
        // Fallback: If not enough data parsed, aggressively parse as HTML
        let fileDateMatch = file.name.match(/\d{2}-\d{2}-\d{4}/) || 
                       file.name.match(/\d{4}-\d{2}-\d{2}/) || 
                       file.name.match(/\d{2}\.\d{2}\.\d{4}/) ||
                       file.name.match(/\d{2}-[a-zA-Z]{3}-\d{4}/i) ||
                       file.name.match(/\d{2}\s[a-zA-Z]{3}\s\d{4}/i);
        let extractedFileDate = fileDateMatch ? fileDateMatch[0].replace(/\s/g, '-') : null;
        if (!extractedFileDate) {
          extractedFileDate = new Date(file.lastModified).toLocaleDateString('en-GB').replace(/\//g, '-');
        }

        let isPoorlyParsed = !jsonData || jsonData.length < 3;
        if (!isPoorlyParsed) {
          const firstRealRow = jsonData.find(r => Array.isArray(r) && r.length > 1 && r.some(c => String(c).trim().length > 0));
          if (!firstRealRow) isPoorlyParsed = true;
        }

        if (isPoorlyParsed) {
          try {
            const textStr = new TextDecoder('utf-8').decode(data);
            if (textStr.includes('<table') || textStr.includes('<TABLE') || textStr.includes('<html')) {
               jsonData = [];
               const doc = new DOMParser().parseFromString(textStr, 'text/html');
               const rows = doc.querySelectorAll('tr');
               rows.forEach(tr => {
                 const rowData: any[] = [];
                 tr.querySelectorAll('th, td').forEach(cell => {
                    rowData.push((cell as any).innerText?.trim() || cell.textContent?.trim() || '');
                 });
                 if (rowData.length > 1) {
                    const hasData = rowData.some(x => String(x || '').trim().length > 0);
                    if (hasData) jsonData.push(rowData);
                 }
               });
            }
          } catch(e) { 
            console.warn('HTML parse fallback failed', e); 
          }
        }
        
        // Clean up data: ensure all cells are strings and normalize whitespaces
        jsonData = (jsonData || []).map(row => (Array.isArray(row) ? row : []).map((cellValue: any) => {
           return cleanStringData(cellValue);
        }));

        let onTimeCount = 0;
        let lateCount = 0;
        let pendingCount = 0;
        let presentCount = 0;
        let absentCount = 0;
        let leaveCount = 0;
        let trainingCount = 0;
        let meetingCount = 0;
        let total = 0;
        const cleanedData: any[] = [];

        // Column indices based on expected report structure
        let startRow = -1;
        let gpCol = -1; 
        let mandalCol = -1; 
        let attendStatusCol = -1;
        let attendTimeCol = -1;
        let dsrStatusCol = -1;
        let dsrTimeCol = -1;

        // Scan the first few rows to find start row
        for(let i = 0; i < Math.min(jsonData.length, 10); i++) {
           const r = jsonData[i];
           if(Array.isArray(r) && r.length > 2) {
              const s0 = cleanStringData(r[0]);
              const s1 = cleanStringData(r[1]);
              // A row starting with '1', or a pure number > 0 in first two cols usually indicates data start
              if (s0 === '1' || s1 === '1' || (/^\d+$/.test(s0) && Number(s0) > 0 && r.length >= 5) || (/^\d+$/.test(s1) && Number(s1) > 0 && r.length >= 5)) {
                 startRow = i;
                 break;
              }
           }
        }
        
        // If we didn't find a clear data row, fallback to old logic
        if (startRow === -1) {
          const firstDataIdx = jsonData.findIndex((r, idx) => 
             idx > 0 && Array.isArray(r) && r.length > 0 && ( /^\d+$/.test(String(r[0]).trim()) || /^\d+$/.test(String(r[1]).trim()) )
          );
          startRow = firstDataIdx !== -1 ? firstDataIdx : 2; 
        }

        // Failsafe: if we failed to detect a decent startRow, just try from row 1
        if (startRow > jsonData.length - 1 || startRow < 0) startRow = 1;

        // Combine headers from rows 0 to startRow-1 to detect columns robustly
        const maxCols = Math.max(...jsonData.slice(0, startRow).map(r => Array.isArray(r) ? r.length : 0));
        for(let c = 0; c < maxCols; c++) {
            let colText = "";
            for(let r = 0; r < startRow; r++) {
                if(Array.isArray(jsonData[r]) && jsonData[r][c]) {
                   colText += " " + cleanStringData(jsonData[r][c]).toLowerCase();
                }
            }
            const str = colText;
            if (str.includes('panchayat') || str.includes('village') || str.includes('gp ') || str.includes('gram') || str.includes('panchayath') || (str.includes('name') && !str.includes('district') && !str.includes('division') && !str.includes('mandal') && !str.includes('state'))) {
               if (!str.includes('lgd') && !str.includes('code') && !str.includes('id')) {
                  if (gpCol === -1 || str.includes('name')) gpCol = c;
               }
            } else if (str.includes('mandal')) {
               if (!str.includes('lgd') && !str.includes('code') && !str.includes('id')) {
                  if (mandalCol === -1 || str.includes('name')) mandalCol = c;
               }
            }
            
            if (str.includes('attend') || str.includes('attnd') || str.includes('first part') || str.includes('first attend')) {
               if (str.includes('time') || str.includes('date') || str.includes('stamp')) {
                  if (attendTimeCol === -1) attendTimeCol = c;
               } else {
                  if (attendStatusCol === -1) attendStatusCol = c;
               }
            }
            
            if (str.includes('dsr status') || str.includes('dsr data') || str.includes('dsr entry status') || str.includes('today') || str.includes('work done') || (str.includes('dsr') && !str.includes('road') && !str.includes('drain') && !str.includes('institution') && !str.includes('image'))) {
               if (dsrStatusCol === -1) dsrStatusCol = c;
            }

            if (str.includes('dsr') && (str.includes('time') || str.includes('date') || str.includes('stamp') || str.includes('submitted'))) {
               if (dsrTimeCol === -1) dsrTimeCol = c;
            }
        }
        
        // Final fallback for column indices if still not detected
        if (gpCol === -1 || mandalCol === -1) {
           const sampleIdx = startRow;
           if (sampleIdx !== -1 && jsonData[sampleIdx]) {
              if (mandalCol === -1) mandalCol = 1;
              if (gpCol === -1) gpCol = 2; // Default assumption for typical govt reports
           }
        }

        // Data-based column detection for Attendance Status (since headers might be misaligned due to colspans)
        const sampleRowForDetection = jsonData.find((r, idx) => idx >= startRow && Array.isArray(r) && r.length > 5 && r.some(c => String(c).toLowerCase().trim() === 'present' || String(c).toLowerCase().trim() === 'absent'));
        if (sampleRowForDetection) {
           // Find the column index that contains 'present' or 'absent'
           const foundIdx = sampleRowForDetection.findIndex(c => String(c).toLowerCase().trim() === 'present' || String(c).toLowerCase().trim() === 'absent');
           if (foundIdx !== -1) {
               attendStatusCol = foundIdx;
           }
        }

        // Hard fallbacks if everything else fails
        if (mandalCol === -1) mandalCol = 1;
        if (gpCol === -1) gpCol = 2;
        if (attendStatusCol === -1) attendStatusCol = 3;
        if (attendTimeCol === -1) attendTimeCol = 4;
        if (dsrStatusCol === -1) dsrStatusCol = 5;
        if (dsrTimeCol === -1) dsrTimeCol = 6;

        for (let i = startRow; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (!row || row.length === 0) continue;
          
          let gpName = row[gpCol] !== undefined ? cleanStringData(row[gpCol]) : "";
          let mandalName = row[mandalCol] !== undefined ? cleanStringData(row[mandalCol]) : "";
          
          // If we have no GP name in the expected column, try to find it in the row
          if (!gpName && row.length > 2) {
             const possibleGP = row.find((c, idx) => idx !== mandalCol && idx !== 0 && String(c).trim().length > 2 && !String(c).toLowerCase().match(/present|absent|entered|not entered|\d\d:\d\d/));
             if (possibleGP) gpName = cleanStringData(possibleGP);
          }

          // If mandal name is missing, try to find it
          if (!mandalName && row.length > 1) {
             const possibleMandal = row.find((c, idx) => idx !== gpCol && idx !== 0 && String(c).trim().length > 2 && String(c).toLowerCase().indexOf('mandal') !== -1);
             if (possibleMandal) mandalName = cleanStringData(possibleMandal);
          }
          
          // Last resort fallback for GP Name
          if (!gpName && row.length >= 1) {
             const possibleTextIdx = row.findIndex((c, idx) => idx > 0 && String(c).trim().length > 2 && !/^\d+$/.test(String(c)));
             gpName = possibleTextIdx !== -1 ? cleanStringData(row[possibleTextIdx]) : cleanStringData(row[1]) || cleanStringData(row[0]) || `Row ${i+1}`;
          }

          if (!gpName) gpName = `Unknown GP ${i+1}`;

          const gpLower = gpName.toLowerCase();
          const mandalLower = (mandalName || "").toLowerCase();

          // Skip persistent header titles or administrative text
          if (gpLower.includes('panchayat name') || gpLower.includes('mandal') || gpLower.includes('telangana') || gpLower.includes('report on') || gpLower.includes('gp tracker')) continue;
          if (gpLower.includes('mandal name') || gpLower.includes('total') || gpLower.includes('summary')) continue;
          
          // Skip generic navigational symbols or very short placeholders
          if (gpLower === "v" || gpLower === "p" || gpLower === "gp" || gpLower === "<" || gpLower === ">" || gpLower === "village") continue;
          if (/^\d+$/.test(gpName)) continue; // Skip if just a number

          total++;
          let attendStatusStr = row[attendStatusCol] !== undefined ? cleanStringData(row[attendStatusCol]) : "";
          let attendTimeStr = row[attendTimeCol] !== undefined ? cleanStringData(row[attendTimeCol]) : "";
          let dsrStatusRaw = row[dsrStatusCol] !== undefined ? cleanStringData(row[dsrStatusCol]).toLowerCase() : "";
          let dsrTimeStr = row[dsrTimeCol] !== undefined ? cleanStringData(row[dsrTimeCol]) : "";

          const fullRowStr = row.map(c => String(c).toLowerCase()).join(' ');
          const allTimes = row.map(c => cleanStringData(c)).filter(c => c.toLowerCase().match(/\d{1,2}:\d{2}\s?(am|pm)/i));
          const allDates = row.map(c => cleanStringData(c)).filter(c => c.match(/\d{2,4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{2,4}/));

          let finalAttendance = "Absent";
          const statusLower = attendStatusStr.toLowerCase();
          const fullRowLower = fullRowStr.toLowerCase();
          
          if (statusLower === 'present' || statusLower === 'p') {
             finalAttendance = "Present";
          } else if (statusLower.includes('leave') || statusLower === 'l' || statusLower.includes('on leave')) {
             finalAttendance = "Leave";
          } else if (statusLower.includes('training') || statusLower === 't') {
             finalAttendance = "Training";
          } else if (statusLower.includes('meeting') || statusLower.includes('district level') || statusLower.includes('state level')) {
             finalAttendance = "Meeting";
          } else if (statusLower === 'absent' || statusLower === 'a') {
             finalAttendance = "Absent";
          } else {
             if (fullRowLower.includes('meeting') || fullRowLower.includes('district level') || fullRowLower.includes('state level')) finalAttendance = "Meeting";
             else if (fullRowLower.includes('training')) finalAttendance = "Training";
             else if (fullRowLower.includes('leave')) finalAttendance = "Leave";
             else if (fullRowLower.includes('present')) finalAttendance = "Present";
             else if (fullRowLower.includes('absent')) finalAttendance = "Absent";
             else finalAttendance = "Present";
          }

          if (!dsrStatusRaw.match(/enter|yes|not/)) {
            if (fullRowStr.includes('not entered')) dsrStatusRaw = "not entered";
            else if (fullRowStr.includes('entered')) dsrStatusRaw = "entered";
          }
          
          if (!attendTimeStr && allTimes.length > 0) attendTimeStr = allTimes[0] || "";
          if (!dsrTimeStr && allTimes.length > 1) dsrTimeStr = allTimes[1] || "";
          else if (!dsrTimeStr && allTimes.length === 1 && dsrStatusRaw.includes('enter')) {
             if (fullRowStr.indexOf(allTimes[0].toLowerCase()) > fullRowStr.indexOf('present')) {
                 dsrTimeStr = allTimes[0];
                 if(attendTimeStr === allTimes[0]) attendTimeStr = "";
             }
          }

          let isEntered = dsrStatusRaw.includes('enter') || dsrStatusRaw.includes('yes') || dsrStatusRaw === 'y' || dsrStatusRaw === 'p' || dsrTimeStr.length > 4 || dsrStatusRaw.includes('true') || dsrStatusRaw.includes('done');
          let isLate = false;

          if (isEntered && dsrTimeStr) {
             const lowerTime = dsrTimeStr.toLowerCase();
             const timeMatch = lowerTime.match(/(\d{1,2}):(\d{2})/);
             if (timeMatch) {
                let hours = parseInt(timeMatch[1], 10);
                const minutes = parseInt(timeMatch[2], 10);
                if (lowerTime.includes('pm') && hours < 12) hours += 12;
                if (lowerTime.includes('am') && hours === 12) hours = 0;
                
                const totalMinutes = (hours * 60) + minutes;
                const cutOffMinutes = (10 * 60) + 30; // 10:30 AM
                if (totalMinutes > cutOffMinutes) isLate = true;
             }
          }

          if (!isEntered) {
            if (finalAttendance === 'Present') {
               pendingCount++;
            }
          } else if (isLate) {
            lateCount++;
          } else {
            onTimeCount++;
          }
          
          if (finalAttendance === 'Present') presentCount++;
          else if (finalAttendance === 'Leave') leaveCount++;
          else if (finalAttendance === 'Training') trainingCount++;
          else if (finalAttendance === 'Meeting') meetingCount++;
          else absentCount++;

          let uiDsrStatus = isEntered ? "Entered" : "Not Entered";
          if (!isEntered && finalAttendance === 'Leave') uiDsrStatus = "On Leave";
          if (!isEntered && finalAttendance === 'Training') uiDsrStatus = "On Training";
          if (!isEntered && finalAttendance === 'Meeting') uiDsrStatus = "In Meeting";
          if (!isEntered && finalAttendance === 'Absent') uiDsrStatus = "N/A (Absent)";

          cleanedData.push({
            id: i,
            sno: cleanStringData(row[0]) || (cleanedData.length + 1),
            gp: gpName,
            mandal: mandalName || params.mandal || "Unknown",
            attendance: finalAttendance,
            attendTime: attendTimeStr || "-",
            dsrStatus: uiDsrStatus,
            dsrTime: dsrTimeStr || "",
            isLate: isLate,
            isEntered: isEntered
          });
        }
        
        // Try content regex if date not set from name
        if (!fileDateMatch) {
           for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
              if (Array.isArray(jsonData[i])) {
                  const rStr = jsonData[i].join(' ');
                  const m = rStr.match(/\d{2}-\d{2}-\d{4}/) || rStr.match(/\d{4}-\d{2}-\d{2}/) || rStr.match(/\d{2}\.\d{2}\.\d{4}/) || rStr.match(/\d{2}-[a-zA-Z]{3}-\d{4}/i) || rStr.match(/\d{2}\/\d{2}\/\d{4}/) || rStr.match(/\d{2}\s[a-zA-Z]{3}\s\d{4}/i);
                  if (m) { extractedFileDate = m[0].replace(/[\.\s\/]/g, '-'); break; }
              }
           }
        }

        setStats({ 
          total, 
          done: onTimeCount + lateCount, 
          pending: pendingCount, 
          late: lateCount, 
          onTime: onTimeCount, 
          present: presentCount, 
          absent: absentCount, 
          leave: leaveCount,
          training: trainingCount,
          meeting: meetingCount,
          date: extractedFileDate
        });
        setReportData(cleanedData);
        setPerfData([
          { name: 'On Time', value: Math.round((onTimeCount / (total || 1)) * 100) || 0, color: '#10b981' },
          { name: 'Late', value: Math.round((lateCount / (total || 1)) * 100) || 0, color: '#f59e0b' },
          { name: 'Pending', value: Math.round((pendingCount / (total || 1)) * 100) || 0, color: '#ef4444' }
        ]);

        if (total > 0) {
          setDebugInfo('');
          addToast(`DSR Processed: ${total} records analyzed! 🚀`);
        } else {
          try { 
            let rawDataPreview = '';
            try {
              const textDecoder = new TextDecoder('utf-8');
              const textStr = textDecoder.decode(new Uint8Array(arrayBuffer));
              rawDataPreview = textStr.substring(0, 1000);
            } catch(e) {}
            // Use safe stringify for previewing data which might have unexpected structure if parsed incorrectly
            setDebugInfo(safeStringify({ 
              jsonDataPreview: jsonData.slice(0, 10), 
              rawDataPreview 
            })); 
          } catch(e){
            setDebugInfo("Error generating debug data: " + String(e));
          }
          addToast(`Found 0 records. Please check if columns match the required format.`);
        }
      } catch (err) {
        addToast("Error processing file. Please verify format.");
        console.error(err);
      } finally {
        setIsAnalyzing(false);
      }
    };
  };

  const downloadReport = () => {
    if (reportData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(reportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DSR_Report");
    XLSX.writeFile(wb, `DSR_Report_${params.mandal}_${params.date}.xlsx`);
    addToast("Report Downloaded!");
  };

  const filteredData = reportData.filter(row => {
    const matchesSearch = (row.gp || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (row.mandal || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAttendance = attendanceFilter === 'All' || row.attendance === attendanceFilter;
    const matchesDsr = dsrFilter === 'All' || row.dsrStatus === dsrFilter;
    return matchesSearch && matchesAttendance && matchesDsr;
  });

  return (
    <div className="dsr-container">
      {/* Clean File Uploader */}
      <div style={{ marginBottom: reportData.length > 0 || debugInfo ? '20px' : '0px', padding: '20px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
           <h4 style={{ margin: 0, color: 'var(--primary)', fontSize: '15px', fontWeight: 700 }}>Upload Website DSR File</h4>
           <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>Select the downloaded format to convert & analyze</p>
        </div>
        <input 
          type="file" 
          onChange={handleFileSelect}
          accept=".xls,.xlsx"
          id="dsr-file-auto-input"
          style={{ display: 'none' }}
        />
        <label htmlFor="dsr-file-auto-input" style={{ background: 'var(--primary)', color: 'white', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isAnalyzing ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
          {isAnalyzing ? 'Processing...' : 'Choose File'}
        </label>
      </div>

      {debugInfo && (
        <div style={{ marginBottom: '20px', padding: '20px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fecaca', overflowX: 'auto' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#991b1b', fontSize: '14px', fontWeight: 700 }}>Error: Failed to identify table format</h4>
          <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#b91c1c' }}>Please send this data screenshot to the developer:</p>
          <pre style={{ fontSize: '10px', background: 'white', padding: '10px', borderRadius: '8px', border: '1px solid #fce7e7' }}>{debugInfo}</pre>
        </div>
      )}

      {reportData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="section-card" style={{ margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ background: 'var(--primary)', color: 'white', padding: '6px', borderRadius: '8px' }}>
                <FileText size={18} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '16px', color: 'var(--primary)', fontWeight: 800 }}>Mana Report Preview</h4>
                <p style={{ margin: 0, fontSize: '11px', color: '#64748b', fontWeight: 600 }}>DSR & Attendance Analysis • {params.date}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
               <button onClick={downloadReport} className="btn-primary" style={{ background: '#16a34a', padding: '8px 16px', fontSize: '13px', border: 'none', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                 <Download size={16} /> Excel
               </button>
               <button onClick={() => window.print()} className="btn-primary" style={{ background: 'var(--primary)', padding: '8px 16px', fontSize: '13px', border: 'none', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                 🖨️ Print
               </button>
            </div>
          </div>
          
          {stats.date && (
            <div style={{ marginBottom: '20px', padding: '10px 15px', background: '#f8fafc', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '8px', border: '1px solid #e2e8f0' }}>
              <Calendar size={16} color="var(--primary)" />
              <span style={{ fontWeight: 700, color: '#334155' }}>Report Date:</span>
              <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{stats.date || 'Unknown Date'}</span>
            </div>
          )}

          {/* Quick Summary Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '15px', background: '#f0f9ff', borderRadius: '12px', border: '1px solid #bae6fd', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#0369a1', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Total GPs</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#0369a1' }}>{stats.total}</div>
            </div>
            <div style={{ padding: '15px', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbfcce', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#166534', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Present</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#16a34a' }}>{stats.present}</div>
            </div>
            <div style={{ padding: '15px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fecaca', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#991b1b', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Absent</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#ef4444' }}>{stats.absent}</div>
            </div>
            <div style={{ padding: '15px', background: '#f1f5f9', borderRadius: '12px', border: '1px solid #cbd5e1', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#475569', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Leave</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#64748b' }}>{stats.leave}</div>
            </div>
            <div style={{ padding: '15px', background: '#fef9c3', borderRadius: '12px', border: '1px solid #fde047', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#854d0e', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Training</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#a16207' }}>{stats.training}</div>
            </div>
            <div style={{ padding: '15px', background: '#ecfeff', borderRadius: '12px', border: '1px solid #a5f3fc', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#0e7490', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Meeting</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#0891b2' }}>{stats.meeting}</div>
            </div>
            <div style={{ padding: '15px', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbfcce', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#166534', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>On Time DSR</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#16a34a' }}>{stats.onTime}</div>
            </div>
            <div style={{ padding: '15px', background: '#fffbeb', borderRadius: '12px', border: '1px solid #fde68a', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#92400e', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Late DSR</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#d97706' }}>{stats.late}</div>
            </div>
            <div style={{ padding: '15px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fecaca', textAlign: 'center' }}>
               <div style={{ fontSize: '10px', color: '#991b1b', fontWeight: 800, textTransform: 'uppercase', marginBottom: '5px' }}>Pending DSR</div>
               <div style={{ fontSize: '24px', fontWeight: 900, color: '#ef4444' }}>{stats.pending}</div>
            </div>
          </div>
          
          {/* Filters Section */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', marginBottom: '20px', padding: '15px', background: '#f1f5f9', borderRadius: '12px' }}>
            <div style={{ flex: '1', minWidth: '200px', position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
              <input 
                type="text" 
                placeholder="Search GP or Mandal..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <select 
                value={attendanceFilter} 
                onChange={(e) => setAttendanceFilter(e.target.value)}
                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: 'white' }}
              >
                <option value="All">Attendance: All</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Leave">Leave</option>
                <option value="Training">Training</option>
                <option value="Meeting">Meeting</option>
              </select>
              <select 
                value={dsrFilter} 
                onChange={(e) => setDsrFilter(e.target.value)}
                style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: 'white' }}
              >
                <option value="All">DSR: All</option>
                <option value="Entered">Entered</option>
                <option value="Not Entered">Not Entered</option>
                <option value="On Leave">On Leave</option>
                <option value="On Training">On Training</option>
                <option value="In Meeting">In Meeting</option>
                <option value="N/A (Absent)">N/A (Absent)</option>
              </select>
            </div>
          </div>
          
          <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#0d3b66', color: 'white' }}>
                  <th rowSpan={2} style={{ padding: '14px 10px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', width: '50px' }}>S.No</th>
                  <th rowSpan={2} style={{ padding: '14px 12px', border: '1px solid rgba(255,255,255,0.1)' }}>Mandal Name</th>
                  <th rowSpan={2} style={{ padding: '14px 12px', border: '1px solid rgba(255,255,255,0.1)' }}>Panchayat Name</th>
                  <th colSpan={2} style={{ padding: '10px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', background: '#1c4c82' }}>Attendence Status</th>
                  <th colSpan={2} style={{ padding: '10px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', background: '#1c4c82' }}>DSR data</th>
                </tr>
                <tr style={{ background: '#1c4c82', color: 'white' }}>
                  <th style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px' }}>First Attendance Status</th>
                  <th style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px' }}>First Attendance Datetime</th>
                  <th style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px' }}>DSR Entry Status</th>
                  <th style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '11px' }}>DSR Submitted Datetime</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length > 0 ? filteredData.map((row, i) => (
                  <tr key={i} style={{ 
                    background: i % 2 === 0 ? 'white' : '#f8fafc',
                    transition: 'background 0.2s'
                  }}>
                    <td style={{ padding: '12px 10px', border: '1px solid #e2e8f0', textAlign: 'center', fontWeight: 600, color: '#64748b' }}>{row.sno}</td>
                    <td style={{ padding: '12px', border: '1px solid #e2e8f0', color: '#334155' }}>{row.mandal}</td>
                    <td style={{ padding: '12px', border: '1px solid #e2e8f0', fontWeight: 700, color: '#0d3b66' }}>{row.gp}</td>
                    <td style={{ 
                      padding: '12px', 
                      border: '1px solid #e2e8f0', 
                      color: row.attendance === 'Present' ? '#16a34a' : (row.attendance === 'Leave' || row.attendance === 'Training' || row.attendance === 'Meeting') ? '#64748b' : '#ef4444', 
                      fontWeight: 700 
                    }}>{row.attendance}</td>
                    <td style={{ padding: '12px', border: '1px solid #e2e8f0', color: '#64748b', fontSize: '11px' }}>{row.attendTime}</td>
                    <td style={{ 
                      padding: '12px', 
                      border: '1px solid #e2e8f0', 
                      color: row.dsrStatus === "Entered" ? (row.isLate ? '#d97706' : '#16a34a') : (row.dsrStatus === "Not Entered" ? '#ef4444' : '#64748b'), 
                      fontWeight: 700 
                    }}>
                      {row.dsrStatus}
                    </td>
                    <td style={{ padding: '12px', border: '1px solid #e2e8f0', color: row.isLate ? '#d97706' : '#64748b', fontSize: '11px', fontWeight: row.isLate ? 800 : 400 }}>
                      {row.dsrTime}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                      No results match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}


    </div>
  );
}

function PRActHub() {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [openParts, setOpenParts] = useState<Set<number>>(new Set());
  const [showBot, setShowBot] = useState(false);

  const pdfUrl = "https://panchayat.gov.in/en/document/the-telangana-panchayat-raj-act-2018/";

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePart = (idx: number) => {
    setOpenParts(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const sections = [
    {
      part: "PART I - PRELIMINARY",
      items: [
        { id: "1-2", num: "1-2", title: "Intro & Definitions", content: (
          <>
            <strong>Section 1:</strong> Act extension (Whole Telangana except Corporations & Cantonments).<br />
            <strong>Section 2:</strong> Definitions like Gram Panchayat, Sarpanch, PS, Backward Classes, etc.
          </>
        )}
      ]
    },
    {
      part: "PART II - GRAM PANCHAYAT",
      items: [
        { id: "3-14", num: "3-14", title: "Constitution & Strength", content: (
          <>
            • <strong>Sec 3:</strong> Village Declaration.<br />
            • <strong>Sec 6:</strong> Gram Sabha (Meetings once in 2 months).<br />
            • <strong>Sec 7:</strong> Strength (5 to 21 members based on population).<br />
            • <strong>Sec 9:</strong> Reservations for SC, ST, BC, and 50% for Women.
          </>
        )},
        { id: "32-43", num: "32-43", title: "Sarpanch & PS Duties", content: (
          <>
            • <strong>Sarpanch (Sec 32):</strong> Sanitation, Water supply, and GP Administration.<br />
            • <strong>Panchayat Secretary (Sec 43):</strong> Records maintenance, 85% plantation survival, tax collection.
          </>
        )},
        { id: "52-70", num: "52-70", title: "Functions & Taxes", content: (
          <>
            • <strong>Sec 52:</strong> Duty of GP to provide street lights, drainage, and cleaning.<br />
            • <strong>Sec 64:</strong> House Tax (Mandatory collection).<br />
            • <strong>Sec 67:</strong> User charges for services.
          </>
        )}
      ]
    },
    {
      part: "PART III - MANDAL PRAJA PARISHAD (MPP)",
      items: [
        { id: "142-160", num: "142-160", title: "MPP Constitution & Functions", content: (
          <>
            • <strong>Sec 142:</strong> Mandal Parishad Constitution.<br />
            • <strong>Sec 147:</strong> Election of President and Vice-President.<br />
            • <strong>Sec 153:</strong> MPP Powers: Agriculture, Health, and Primary Education support.
          </>
        )}
      ]
    },
    {
      part: "PART IV - ZILLA PRAJA PARISHAD (ZPP)",
      items: [
        { id: "172-195", num: "172-195", title: "ZPP Administration", content: (
          <>
            • <strong>Sec 172:</strong> Formation of Zilla Parishad.<br />
            • <strong>Sec 184:</strong> Standing Committees (Total 7 committees for Finance, Works, etc).<br />
            • <strong>CEO:</strong> Appointment and duties for ZPP.
          </>
        )}
      ]
    },
    {
      part: "PART V & VI - ELECTIONS & FINANCE",
      items: [
        { id: "200-240", num: "200-240", title: "State Election & Finance", content: (
          <>
            • <strong>Sec 200:</strong> State Election Commission (SEC) powers.<br />
            • <strong>Sec 235:</strong> State Finance Commission recommendations for fund distribution.
          </>
        )}
      ]
    },
    {
      part: "PART VII, VIII & IX - SCHEDULED AREAS & PENALTIES",
      items: [
        { id: "242-290", num: "242-290", title: "Special Rules & Fines", content: (
          <>
            • <strong>Part VII:</strong> Scheduled Areas (PESA rules) - Special powers to Gram Sabhas.<br />
            • <strong>Sec 287:</strong> General Penalties for violating Act rules.<br />
            • <strong>Schedule VII:</strong> List of 16 Village Level Functionaries (VRO, AEO, ANM, etc) under GP.
          </>
        )}
      ]
    }
  ];

  return (
    <div style={{ padding: '0px', width: '100%', maxWidth: '900px', margin: '0 auto', position: 'relative' }}>
      <div style={{ textAlign: 'center', background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', marginBottom: '25px', borderBottom: '5px solid var(--primary)', position: 'relative' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '800', color: 'var(--primary)', margin: 0 }}>Telangana Panchayat Raj Act, 2018 (Full Data)</h1>
        <p style={{ fontSize: '12px', color: '#64748b', marginTop: '5px', fontStyle: 'italic' }}>
          Data referenced from: <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>Official TPRA 2018 Document</a>
        </p>
        
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '15px' }}>
          <button 
            onClick={() => setShowBot(!showBot)}
            style={{ 
              background: 'var(--primary)', 
              color: 'white', 
              border: 'none', 
              padding: '8px 15px', 
              borderRadius: '20px', 
              fontSize: '12px', 
              fontWeight: '600', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Bot size={16} /> {showBot ? "Close Assistant" : "Ask PR Act Assistant"}
          </button>
          
          <a 
            href={pdfUrl} 
            target="_blank" 
            rel="noreferrer"
            style={{ 
              background: '#f1f5f9', 
              color: '#475569', 
              textDecoration: 'none',
              padding: '8px 15px', 
              borderRadius: '20px', 
              fontSize: '12px', 
              fontWeight: '600', 
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid #e2e8f0'
            }}
          >
            <FileText size={16} /> View Official PDF
          </a>
        </div>
      </div>

      <AnimatePresence>
        {showBot && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{ marginBottom: '25px' }}
          >
            <SmartAssistant 
              title="PR Act Assistant"
              placeholder="Ask me about Section 32, Gram Sabha, or MPP..."
              icon={Book}
              systemInstruction={`You are an expert AI Search Bot for the Telangana Panchayat Raj Act, 2018 (TPRA 2018). 
              Your goal is to answer users' questions concisely based on the following key points of the Act:
              - PART I (Preliminary): Definitions like GP, Sarpanch, PS, BC, etc.
              - PART II (Gram Panchayat): 
                - Sec 3: Village Declaration.
                - Sec 6: Gram Sabha (Meetings every 2 months).
                - Sec 7: Strength (5-21 members).
                - Sec 9: Reservations (SC, ST, BC, 50% Women).
                - Sec 32: Sarpanch duties (Sanitation, Water, Administration).
                - Sec 43: Panchayat Secretary duties (Records, 85% plantation survival, Taxes).
                - Sec 52: GP functions (Street lights, drainage).
                - Sec 64: House Tax (Mandatory).
                - Sec 67: User charges.
              - PART III (MPP): Sec 142 Constitution, Sec 147 Elections, Sec 153 Powers (Agri, Health, Edu).
              - PART IV (ZPP): Sec 172 Formation, Sec 184 Standing Committees (7 committees), CEO roles.
              - PART V & VI: Sec 200 SEC powers, Sec 235 Finance Commission.
              - PART VII (PESA): Scheduled areas, special powers to Gram Sabhas.
              - PART VIII & IX: Sec 287 Penalties, Schedule VII (16 Village level functionaries).
              
              Data Source Ref: https://panchayat.gov.in/en/document/the-telangana-panchayat-raj-act-2018/
              If the question is unrelated to the PR Act, politely redirect the user. Keep answers professional and structured.`}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {sections.map((part, pIdx) => (
        <div key={pIdx}>
          <div 
            onClick={() => togglePart(pIdx)}
            style={{ 
              background: '#1e40af', 
              color: 'white', 
              padding: '12px 20px', 
              borderRadius: '12px', 
              margin: '25px 0 10px 0', 
              fontSize: '15px', 
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
            }}
          >
            <span>{part.part}</span>
            <span style={{ fontSize: '10px' }}>{openParts.has(pIdx) ? "▲" : "▼"}</span>
          </div>
          
          <AnimatePresence>
            {openParts.has(pIdx) && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ overflow: 'hidden' }}>
                <div style={{ padding: '5px 0' }}>
                  {part.items.map((item) => (
                    <div key={item.id} style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                      <div 
                        onClick={() => toggleSection(item.id)}
                        style={{ padding: '15px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: '600' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ color: 'var(--primary)', fontWeight: '800', minWidth: '30px' }}>{item.num}</span>
                          <span style={{ fontSize: '14px' }}>{item.title}</span>
                        </div>
                        <span style={{ transition: 'transform 0.3s', fontSize: '10px', transform: openSections.has(item.id) ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                      </div>
                      <AnimatePresence>
                        {openSections.has(item.id) && (
                          <motion.div 
                            initial={{ height: 0 }} 
                            animate={{ height: 'auto' }} 
                            exit={{ height: 0 }} 
                            style={{ overflow: 'hidden', background: '#fafafa' }}
                          >
                            <div style={{ padding: '20px', borderTop: '1px solid #eee', lineHeight: '1.7', fontSize: '13px', color: '#475569' }}>
                              {item.content}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}

function SmartAssistant({ systemInstruction, placeholder, title, icon: Icon }: { systemInstruction: string, placeholder: string, title: string, icon: any }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  const askBot = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setAnswer('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: String(query) }] }],
        config: { 
          systemInstruction: String(systemInstruction)
        }
      });
      setAnswer(response.text || "I couldn't find an answer. Please try again.");
    } catch (err) {
      console.error(err);
      setAnswer("Sorry, I encountered an error. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '15px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
        <div style={{ background: 'var(--primary)', color: 'white', padding: '8px', borderRadius: '10px' }}>
          {Icon ? <Icon size={18} /> : <Sparkles size={18} />}
        </div>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: 'var(--primary)' }}>{title}</h3>
      </div>
      
      <div style={{ display: 'flex', gap: '10px' }}>
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && askBot()}
          placeholder={placeholder}
          style={{ flex: 1, padding: '12px 15px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' }}
        />
        <button 
          onClick={askBot}
          disabled={loading}
          style={{ 
            background: 'var(--primary)', 
            color: 'white', 
            border: 'none', 
            padding: '0 20px', 
            borderRadius: '10px', 
            fontWeight: '600', 
            cursor: 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "..." : <Send size={18} />}
        </button>
      </div>

      {answer && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          style={{ marginTop: '15px', padding: '15px', background: 'white', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', lineHeight: '1.6', color: '#1e293b' }}
        >
          <div className="markdown-body">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        </motion.div>
      )}
    </div>
  );
}
