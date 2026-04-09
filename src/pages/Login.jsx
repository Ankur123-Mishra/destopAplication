import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { generateOtp, verifyOtp } from "../api/auth";
import { getToken, setToken, setStoredUser } from "../api/authStorage";

const OTP_LENGTH = 4;
const RESEND_COOLDOWN_SEC = 60;

function normalizeMobile(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 10) return digits;
  if (digits.startsWith("91") && digits.length === 12) return digits.slice(2);
  return digits.slice(-10);
}

export default function Login() {
  const navigate = useNavigate();
  const { user, authReady, setUser } = useApp();
  const [mobile, setMobile] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (!authReady) return;
    if (user && getToken()) {
      navigate("/dashboard", { replace: true });
    }
  }, [authReady, navigate, user]);

  const handleMobileChange = (e) => {
    setError("");
    setMobile(normalizeMobile(e.target.value));
  };

  const sendOtp = async () => {
    const digits = mobile.replace(/\D/g, "");
    if (digits.length !== 10) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await generateOtp(digits);
      setOtpSent(true);
      setOtp("");
      setResendCooldown(RESEND_COOLDOWN_SEC);
    } catch (err) {
      setError(err?.message || "Failed to send OTP. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (otp.length !== OTP_LENGTH) {
      setError("Please enter the 4-digit OTP.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const digits = mobile.replace(/\D/g, "");
      const data = await verifyOtp(digits, otp);
      const token =
        data?.token ??
        data?.accessToken ??
        data?.data?.token ??
        data?.data?.accessToken;
      if (token) setToken(token);
      const userPayload = data?.user ?? data?.data?.user ?? data?.data;
      const user = {
        id: userPayload?.id ?? userPayload?._id ?? "1",
        name: userPayload?.name ?? "Photographer User",
        email: userPayload?.email ?? null,
        mobile: userPayload?.mobile
          ? `+91${String(userPayload.mobile).replace(/\D/g, "").slice(-10)}`
          : `+91${digits}`,
        pointsBalance:
          typeof userPayload?.pointsBalance === "number" &&
          Number.isFinite(userPayload.pointsBalance)
            ? userPayload.pointsBalance
            : null,
        perStudentTemplateCost:
          typeof userPayload?.perStudentTemplateCost === "number" &&
          Number.isFinite(userPayload.perStudentTemplateCost)
            ? userPayload.perStudentTemplateCost
            : null,
      };
      setStoredUser(user);
      setUser(user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err?.message || "Invalid OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  
  const goBackToMobile = () => {
    setOtpSent(false);
    setOtp("");
    setError("");
  };

  const handleSkipLogin = () => {
    const mockUser = {
      id: "offline-user",
      name: "Offline User",
      email: null,
      mobile: "+910000000000",
      pointsBalance: null,
      perStudentTemplateCost: null,
    };
    setToken("offline-dummy-token");
    setStoredUser(mockUser);
    setUser(mockUser);
    navigate("/dashboard", { replace: true });
  };
  
  return (
    <div className="login-page">
      <div className="login-card card">
        <div className="login-header">
          <span className="login-logo">📷</span>
          <h1>Photographer Login</h1>
          <p className="text-muted">School ID Card Automation</p>
        </div>

        {!otpSent ? (
          <div className="login-form-block">
            <label>Mobile Number</label>
            <input
              type="tel"
              className="input-field"
              placeholder="Enter 10-digit mobile number"
              value={mobile}
              onChange={handleMobileChange}
              maxLength={10}
              autoComplete="tel"
            />
            {error && <p className="login-error">{error}</p>}
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%", padding: 14, marginTop: 8 }}
              disabled={loading || mobile.replace(/\D/g, "").length !== 10}
              onClick={sendOtp}
            >
              {loading ? "Sending OTP..." : "Send OTP"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleVerifyOtp} className="login-form">
            <p className="login-otp-sent">
              OTP sent to <strong>+91 {mobile}</strong>
            </p>
            <button
              type="button"
              className="link-btn back-mobile"
              onClick={goBackToMobile}
            >
              Change number
            </button>
            <label>Enter OTP</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input-field otp-input"
              placeholder="4-digit OTP"
              value={otp}
              onChange={(e) => {
                setError("");
                const v = e.target.value
                  .replace(/\D/g, "")
                  .slice(0, OTP_LENGTH);
                setOtp(v);
              }}
              maxLength={OTP_LENGTH}
              autoComplete="one-time-code"
            />
            {error && <p className="login-error">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%", padding: 14, marginTop: 8 }}
              disabled={loading || otp.length !== OTP_LENGTH}
            >
              {loading ? "Verifying..." : "Verify & Login"}
            </button>
            <button
              type="button"
              className="link-btn resend-otp"
              disabled={resendCooldown > 0 || loading}
              onClick={async () => {
                if (resendCooldown > 0) return;
                setError("");
                setLoading(true);
                try {
                  await generateOtp(mobile.replace(/\D/g, ""));
                  setOtp("");
                  setResendCooldown(RESEND_COOLDOWN_SEC);
                } catch (err) {
                  setError(err?.message || "Failed to resend OTP.");
                } finally {
                  setLoading(false);
                }
              }}
            >
              {resendCooldown > 0
                ? `Resend OTP in ${resendCooldown}s`
                : "Resend OTP"}
            </button>
          </form>
        )}

        <div style={{ textAlign: "center", marginTop: "24px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <button type="button" className="btn btn-secondary" onClick={handleSkipLogin} style={{ width: "100%", padding: 14 }}>
            Skip Login
          </button>
        </div>

        <style>{`
          .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
          .login-card { max-width: 400px; width: 100%; }
          .login-header { text-align: center; margin-bottom: 28px; }
          .login-logo { font-size: 3rem; display: block; margin-bottom: 12px; }
          .login-header h1 { font-size: 1.5rem; margin-bottom: 4px; }
          .login-form label, .login-form-block label { display: block; margin-bottom: 6px; font-size: 0.9rem; color: var(--text-muted); }
          .login-form .input-field, .login-form-block .input-field { margin-bottom: 16px; }
          .login-form .otp-input { font-size: 1.25rem; letter-spacing: 0.5em; text-align: center; }
          .link-btn { background: none; color: var(--accent); font-size: 0.9rem; padding: 0; margin-bottom: 16px; cursor: pointer; border: none; }
          .link-btn:hover:not(:disabled) { text-decoration: underline; }
          .link-btn:disabled { opacity: 0.6; cursor: not-allowed; }
          .back-mobile { margin-bottom: 8px; }
          .resend-otp { display: block; margin-top: 12px; }
          .login-error { color: var(--danger, #c00); font-size: 0.85rem; margin: -8px 0 12px; }
          .login-otp-sent { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 4px; }
        `}</style>
      </div>
    </div>
  );
}
