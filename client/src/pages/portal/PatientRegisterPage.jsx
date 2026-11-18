/**
 * PatientRegisterPage — Patient portal account creation
 *
 * Flow: doctor generates invite → patient receives link with ?token=RAW_TOKEN →
 * this page pre-fills the token → patient completes the form → account created →
 * redirected to /portal/history.
 *
 * Milestone 1 improvements:
 *   - Client-side password length validation with inline error message.
 *   - Distinct error messages for invalid/expired token vs. email already in use.
 *   - Password visibility toggle.
 *   - "Already have an account?" link preserved.
 */

import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientAuth } from '../../contexts/PatientPortalAuthContext.jsx';

export default function PatientRegisterPage() {
  const { register, isAuthenticated, isLoading } = usePatientAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [inviteToken,  setInviteToken]  = useState(searchParams.get('token') ?? '');
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [displayName,  setDisplayName]  = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors,       setErrors]       = useState({});   // field-level errors
  const [serverError,  setServerError]  = useState('');   // API-level error
  const [submitting,   setSubmitting]   = useState(false);

  // Already signed in — go straight to history
  if (!isLoading && isAuthenticated) {
    return <Navigate to="/portal/history" replace />;
  }

  // ── Client-side validation ─────────────────────────────────────────────
  function validate() {
    const e = {};
    if (!inviteToken.trim())    e.inviteToken  = 'Invite token is required.';
    if (!displayName.trim())    e.displayName  = 'Your name is required.';
    if (!email.trim())          e.email        = 'Email address is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                                e.email        = 'Enter a valid email address.';
    if (!password)              e.password     = 'Password is required.';
    else if (password.length < 8)
                                e.password     = 'Password must be at least 8 characters.';
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const fieldErrors = validate();
    setErrors(fieldErrors);
    setServerError('');
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    const result = await register({
      inviteToken: inviteToken.trim(),
      email:       email.trim(),
      password,
      displayName: displayName.trim(),
    });
    setSubmitting(false);

    if (!result?.success) {
      // Map server error messages to user-friendly text
      const msg = result?.message ?? '';
      if (/invalid or expired/i.test(msg)) {
        setErrors({ inviteToken: 'Invalid or expired invite token. Ask your doctor for a new one.' });
      } else if (/already exists/i.test(msg)) {
        setErrors({ email: 'An account with this email already exists. Try signing in instead.' });
      } else {
        setServerError(msg || 'Registration failed. Please check your details and try again.');
      }
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

        {serverError && (
          <p className="auth-error" role="alert">{serverError}</p>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {/* Invite token */}
          <div className="auth-field">
            <label htmlFor="pp-token" className="auth-label">Invite token</label>
            <input
              id="pp-token"
              type="text"
              className={`auth-input${errors.inviteToken ? ' is-invalid' : ''}`}
              autoComplete="off"
              value={inviteToken}
              onChange={(e) => { setInviteToken(e.target.value); setErrors((prev) => ({ ...prev, inviteToken: '' })); }}
              disabled={submitting}
              placeholder="Provided by your doctor"
              aria-describedby={errors.inviteToken ? 'pp-token-error' : undefined}
            />
            {errors.inviteToken && (
              <p id="pp-token-error" className="auth-field-error" role="alert">{errors.inviteToken}</p>
            )}
          </div>

          {/* Display name */}
          <div className="auth-field">
            <label htmlFor="pp-name" className="auth-label">Your name</label>
            <input
              id="pp-name"
              type="text"
              className={`auth-input${errors.displayName ? ' is-invalid' : ''}`}
              autoComplete="name"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setErrors((prev) => ({ ...prev, displayName: '' })); }}
              disabled={submitting}
              aria-describedby={errors.displayName ? 'pp-name-error' : undefined}
            />
            {errors.displayName && (
              <p id="pp-name-error" className="auth-field-error" role="alert">{errors.displayName}</p>
            )}
          </div>

          {/* Email */}
          <div className="auth-field">
            <label htmlFor="pp-email" className="auth-label">Email</label>
            <input
              id="pp-email"
              type="email"
              className={`auth-input${errors.email ? ' is-invalid' : ''}`}
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((prev) => ({ ...prev, email: '' })); }}
              disabled={submitting}
              aria-describedby={errors.email ? 'pp-email-error' : undefined}
            />
            {errors.email && (
              <p id="pp-email-error" className="auth-field-error" role="alert">{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div className="auth-field">
            <label htmlFor="pp-password" className="auth-label">Password</label>
            <div className="auth-password-row">
              <input
                id="pp-password"
                type={showPassword ? 'text' : 'password'}
                className={`auth-input auth-input--password${errors.password ? ' is-invalid' : ''}`}
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((prev) => ({ ...prev, password: '' })); }}
                disabled={submitting}
                aria-describedby={errors.password ? 'pp-password-error' : 'pp-password-hint'}
              />
              <button
                type="button"
                className="auth-toggle-pw"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
            {errors.password ? (
              <p id="pp-password-error" className="auth-field-error" role="alert">{errors.password}</p>
            ) : (
              <p id="pp-password-hint" className="auth-hint">At least 8 characters.</p>
            )}
          </div>

          <button
            type="submit"
            className="auth-submit"
            disabled={submitting}
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
