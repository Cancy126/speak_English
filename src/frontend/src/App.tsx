import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './hooks/useAuth';
import { AdminPage } from './pages/AdminPage';
import { ChatPage } from './pages/ChatPage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

function AdminRoute() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <AdminPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Layout requireAuth={false}><LoginPage /></Layout>} />
        <Route path="/register" element={<Layout requireAuth={false}><RegisterPage /></Layout>} />
        <Route path="/" element={<Layout><HomePage /></Layout>} />
        <Route path="/chat" element={<Layout><HomePage /></Layout>} />
        <Route path="/chat/:id" element={<Layout><ChatPage /></Layout>} />
        <Route path="/history" element={<Layout><HistoryPage /></Layout>} />
        <Route path="/admin" element={<Layout><AdminRoute /></Layout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
