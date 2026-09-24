import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [error,      setError]      = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated — skip the login page.
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    setError('');
    setSubmitting(true);

    const result = await login({ email: email.trim(), password });

    setSubmitting(false);

    if (!result.success) {
      // Use a generic message — do not reveal whether the account exists.
      setError('Invalid email or password.');
      return;
    }

    navigate('/dashboard', { replace: true });
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="app-logo-mark" aria-hidden="true">VS</span>
          <span className="app-brand-name">VoiceScribe</span>
        </div>
        <p className="auth-subtitle">Clinical documentation assistant</p>

        <h1 className="auth-title">Sign in</h1>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label htmlFor="email" className="auth-label">Email</label>
            <input
              id="email"
              type="email"
              className="auth-input"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password" className="auth-label">Password</label>
            <input
              id="password"
              type="password"
              className="auth-input"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          {error && (
            <p className="auth-error" role="alert">{error}</p>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-switch">
          New to VoiceScribe?{' '}
          <Link to="/register" className="auth-link">Create an account</Link>
        </p>

        <p className="auth-safety">
          🔒 VoiceScribe does not diagnose or prescribe.
        </p>
      </div>
    </div>
  );
}
