import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { getPhotographerPointsBalance } from "../api/dashboard";

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function resolveUserPoints(user) {
  return {
    pointsBalance: pickNumber(user?.pointsBalance, user?.data?.pointsBalance),
    perStudentTemplateCost: pickNumber(
      user?.perStudentTemplateCost,
      user?.data?.perStudentTemplateCost,
    ),
  };
}

export default function Header({ title, showBack, backTo, onBackClick }) {
  console.log('Header', title);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isSyncing, syncMessage } = useApp();
  const [pointsBalance, setPointsBalance] = useState(null);
  const [perStudentTemplateCost, setPerStudentTemplateCost] = useState(null);
  const [pointsLoading, setPointsLoading] = useState(false);

  useEffect(() => {
    const fallback = resolveUserPoints(user);
    setPointsBalance((prev) => (prev == null ? fallback.pointsBalance : prev));
    setPerStudentTemplateCost((prev) =>
      prev == null ? fallback.perStudentTemplateCost : prev,
    );
  }, [user]);

  const loadPointsBalance = useCallback(async () => {
    const fallback = resolveUserPoints(user);
    if (!user) {
      setPointsBalance(null);
      setPerStudentTemplateCost(null);
      return;
    }
    setPointsLoading(true);
    try {
      const res = await getPhotographerPointsBalance();
      setPointsBalance(res?.pointsBalance ?? fallback.pointsBalance);
      setPerStudentTemplateCost(
        res?.perStudentTemplateCost ?? fallback.perStudentTemplateCost,
      );
    } catch {
      setPointsBalance(fallback.pointsBalance);
      setPerStudentTemplateCost(fallback.perStudentTemplateCost);
    } finally {
      setPointsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadPointsBalance();
  }, [loadPointsBalance, location.pathname]);

  useEffect(() => {
    const onPointsUpdated = (event) => {
      const nextBalance = event?.detail?.pointsBalance;
      const nextRate = event?.detail?.perStudentTemplateCost;
      if (typeof nextBalance === "number" && Number.isFinite(nextBalance)) {
        setPointsBalance(nextBalance);
      }
      if (typeof nextRate === "number" && Number.isFinite(nextRate)) {
        setPerStudentTemplateCost(nextRate);
      }
    };

    window.addEventListener("photographer-points-updated", onPointsUpdated);
    return () =>
      window.removeEventListener(
        "photographer-points-updated",
        onPointsUpdated,
      );
  }, []);

  const handleBack = () => {
    if (onBackClick) onBackClick();
    else navigate(backTo || -1);
  };
  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="header">
      <div className="header-left">
        {showBack && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleBack}
          >
            ← Back
          </button>
        )}
        {title && <h1 className="header-title">{title}</h1>}
      </div>
      {user && (
        <div className="header-right">
          {isSyncing && (
            <div className="header-points" style={{ borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.2)' }}>
              <span className="header-points-label" style={{ color: '#38bdf8' }}>Syncing</span>
              <strong className="header-points-value" style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
                {syncMessage}
              </strong>
            </div>
          )}
          {/* <div
            className="header-points"
            title="Available template download points"
          >
            <span className="header-points-label">Wallet</span>
            <strong className="header-points-value">
              {pointsLoading
                ? "..."
                : pointsBalance == null
                  ? "--"
                  : pointsBalance}
            </strong>
            {perStudentTemplateCost != null && (
              <span className="header-points-rate">
                ({perStudentTemplateCost}/student)
              </span>
            )}
          </div> */}
          <span className="header-user">
            {user.name || user.mobile || user.email}
          </span>
          {/* <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleLogout}
          >
            Logout
          </button> */}
        </div>
      )}
    </header>
  );
}
