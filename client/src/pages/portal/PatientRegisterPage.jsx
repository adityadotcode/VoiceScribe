import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientAuth } from '../../contexts/PatientPortalAuthContext.jsx';

export default function PatientRegisterPage() {
  const { register, isAuthenticated, isLoading } = usePatientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [inviteToken, setInviteToken] = useState(searchParams.get('token') ?? '');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error,       setError]       = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/portal/history" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    const result = await register({
      inviteToken: inviteToken.trim(),
      email:       email.trim(),
      password,
      displayName: displayName.trim(),
    });
    setSubmitting(false);
    if (!result?.success) {
      setError(result?.message || 'Registration failed. Please check your invite token.');
      return;
    }
    navigate('/portal/history', { replace: true });
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="app-logo-mark" aria-hidden="true">VS</span>
          <span className="app-brand-name">VoiceScribe</span>
        </div>
        <p className="auth-subtitle">Patient health record portal</p>

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub-hint">
          Enter the invite token your doctor provided, then choose an email and password.
        </p>

        {error && (
          <p className="auth-error" role="alert">{error}</p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label htmlFor="pp-token" className="auth-label">Invite token</label>
            <input
              id="pp-token"
              type="text"
              className="auth-input"
              autoComplete="off"
              required
              value={inviteToken}
              onChange={(e) => setInviteToken(e.target.value)}
              disabled={submitting}
              placeholder="Provided by your doctor"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="pp-name" className="auth-label">Your name</label>
            <input
              id="pp-name"
              type="text"
              className="auth-input"
              autoComplete="name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="pp-email" className="auth-label">Email</label>
            <input
              id="pp-email"
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
            <label htmlFor="pp-password" className="auth-label">Password</label>
            <input
              id="pp-password"
              type="password"
              className="auth-input"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <p className="auth-hint">At least 8 characters.</p>
          </div>
          <button
            type="submit"
            className="auth-submit"
            disabled={submitting || !inviteToken || !email || !password || !displayName}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/portal/login" className="auth-link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
