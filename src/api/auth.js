/**
 * Auth APIs - generate OTP, verify OTP. Baaki APIs alag files mein add karke yahi pattern use karenge.
 */
import { API_BASE_URL } from './config';
import { ROLE } from './authStorage';

export async function generateOtp(mobile) {
  const res = await fetch(`${API_BASE_URL}/api/public/generate-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mobile: String(mobile).replace(/\D/g, ''),
      role: ROLE,
    }),
  });
  const data = await res.json().catch(() => ({}));
  console.log('data otp', data);
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'Failed to send OTP';
    throw new Error(msg);
  }
  return data;
}



export async function verifyOtp(mobile, otp) {
  const res = await fetch(`${API_BASE_URL}/api/public/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mobile: String(mobile).replace(/\D/g, ''),
      otp: String(otp).trim(),
      role: ROLE,
    }),
  });
  const data = await res.json().catch(() => ({}));
  console.log('data verify otp', data);
  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText || 'Invalid OTP';
    throw new Error(msg);
  }
  return data;
}
