import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function RegisterPage() {
  const { register, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  const [displayName,      setDisplayName]      = useState('');
  const [email,            setEmail]            = useState('');
  const [password,         setPassword]         = useState('');
  const [confirmPassword,  setConfirmPassword]  = useState('');
  const [error,            setError]            = useState('');
  const [fieldErrors,      setFieldErrors]      = useState({});
  const [submitting,       setSubmitting]       = useState(false);

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  function validate() {
    const errs = {};
    if (!displayName.trim())              errs.displayName = 'Name is required.';
    if (!email.trim())                    errs.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                                          errs.email = 'Enter a valid email address.';
    if (!password)                        errs.password = 'Password is required.';
    else if (password.length < 8)         errs.password = 'Password must be at least 8 characters.';
    if (!confirmPassword)                 errs.confirmPassword = 'Please confirm your password.';
    else if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match.';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    setError('');
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);

    const result = await register({
      email:       email.trim(),
      password,
      displayName: displayName.trim(),
    });

    setSubmitting(false);

    if (!result.success) {
      setError(result.message || 'Registration failed. Please try again.');
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

        <h1 className="auth-title">Create account</h1>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label htmlFor="displayName" className="auth-label">Your name</label>
            <input
              id="displayName"
              type="text"
              className={`auth-input${fieldErrors.displayName ? ' is-invalid' : ''}`}
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
            />
            {fieldErrors.displayName && (
              <p className="auth-field-error">{fieldErrors.displayName}</p>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="email" className="auth-label">Email</label>
            <input
              id="email"
              type="email"
              className={`auth-input${fieldErrors.email ? ' is-invalid' : ''}`}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            {fieldErrors.email && (
              <p className="auth-field-error">{fieldErrors.email}</p>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="password" className="auth-label">Password</label>
            <input
              id="password"
              type="password"
              className={`auth-input${fieldErrors.password ? ' is-invalid' : ''}`}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            {fieldErrors.password && (
              <p className="auth-field-error">{fieldErrors.password}</p>
            )}
          </div>

          <div className="auth-field">
            <label htmlFor="confirmPassword" className="auth-label">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              className={`auth-input${fieldErrors.confirmPassword ? ' is-invalid' : ''}`}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
            />
            {fieldErrors.confirmPassword && (
              <p className="auth-field-error">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          {error && (
            <p className="auth-error" role="alert">{error}</p>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={submitting}
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account?{' '}
          <Link to="/login" className="auth-link">Sign in</Link>
        </p>

        <p className="auth-safety">
          🔒 VoiceScribe does not diagnose or prescribe.
        </p>
      </div>
    </div>
  );
}
