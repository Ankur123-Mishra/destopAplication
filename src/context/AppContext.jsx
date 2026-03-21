import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { getToken, getStoredUser } from '../api/authStorage';

const AppContext = createContext(null);

const MOCK_SCHOOLS = [
  { id: 's1', name: 'Delhi Public School', address: 'Sector 45, Noida', totalStudents: 420, status: 'Active' },
  { id: 's2', name: 'Kendriya Vidyalaya', address: 'Sector 62, Noida', totalStudents: 380, status: 'Active' },
  { id: 's3', name: 'St. Mary\'s Convent', address: 'Greater Noida', totalStudents: 250, status: 'Active' },
];

const MOCK_CLASSES = [
  { id: 'c1', name: 'Class 10A', totalStudents: 5, pending: 2, uploaded: 3 },
  { id: 'c2', name: 'Class 10B', totalStudents: 5, pending: 3, uploaded: 2 },
  { id: 'c3', name: 'Class 9A', totalStudents: 5, pending: 5, uploaded: 0 },
];

const STATUS_OPTIONS = ['pending', 'photo_uploaded', 'correction_required', 'approved', 'printed', 'delivered'];

const makeStudents = (classId, count = 5) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${classId}-st${i + 1}`,
    studentId: `STU${1000 + i}`,
    name: `Student ${i + 1}`,
    status: STATUS_OPTIONS[i % STATUS_OPTIONS.length],
    photoUrl: null,
  }));

const MOCK_STUDENTS_BY_CLASS = {
  c1: makeStudents('c1'),
  c2: makeStudents('c2'),
  c3: makeStudents('c3'),
};

let nextStudentSeq = 100;
function generateStudentId(classId) {
  return `${classId}-new-${++nextStudentSeq}`;
}

const MOCK_NOTIFICATIONS = [
  { id: 'n1', title: 'New school assigned', message: 'DPS Sector 45 has been assigned to you.', time: '2 hours ago', read: false },
  { id: 'n2', title: 'Correction required', message: '3 students in Class 10A need photo correction.', time: '5 hours ago', read: false },
  { id: 'n3', title: 'Deadline reminder', message: 'KV Sector 62 - Submit by Feb 25.', time: '1 day ago', read: true },
];

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [schools] = useState(MOCK_SCHOOLS);

  // App load par stored token + user se session restore (Electron restart ke baad bhi login rahe)
  useEffect(() => {
    const token = getToken();
    const storedUser = getStoredUser();
    if (token && storedUser) setUser(storedUser);
  }, []);
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [studentsByClass, setStudentsByClass] = useState(MOCK_STUDENTS_BY_CLASS);
  const [pendingUploads, setPendingUploads] = useState([]);
  const [offlineMode, setOfflineMode] = useState(false);
  const [savedIdCards, setSavedIdCards] = useState({}); // { [studentId]: [{ id, templateId, studentImage, name, studentId, className, schoolName, savedAt }] }

  const classes = useMemo(() => MOCK_CLASSES, []);

  const getIdCardsForStudent = (studentId) => savedIdCards[studentId] || [];
  const addSavedIdCard = (studentId, data, options = {}) => {
    const id = `idcard-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const card = {
      id,
      ...data,
      savedAt: new Date().toISOString(),
      ...(options.schoolId != null && { schoolId: options.schoolId }),
      ...(options.classId != null && { classId: options.classId }),
    };
    setSavedIdCards((prev) => ({
      ...prev,
      [studentId]: [...(prev[studentId] || []), card],
    }));
    return id;
  };
  const getSavedIdCard = (studentId, idCardId) => {
    const list = savedIdCards[studentId] || [];
    return list.find((c) => c.id === idCardId) || null;
  };
  /** Returns all saved ID cards with studentId; each item may have schoolId, classId if saved from fill page */
  const getAllSavedIdCards = () => {
    const list = [];
    Object.keys(savedIdCards).forEach((studentId) => {
      (savedIdCards[studentId] || []).forEach((card) => {
        list.push({ ...card, studentId });
      });
    });
    return list;
  };

  const getClasses = () => classes;
  const getStudents = (classId) => studentsByClass[classId] || [];
  // console.log("studentsByClass", studentsByClass);
  // console.log("getStudents", getStudents('c1'));

  const updateStudentStatus = (classId, studentId, status, photoUrl = null) => {
    setStudentsByClass((prev) => {
      const list = prev[classId] || [];
      return {
        ...prev,
        [classId]: list.map((s) =>
          s.id === studentId ? { ...s, status, photoUrl: photoUrl ?? s.photoUrl } : s
        ),
      };
    });
  };

  const MAX_STUDENTS_PER_CLASS = 5;

  const addStudent = (classId, { name, studentId: customStudentId }) => {
    const current = studentsByClass[classId] || [];
    if (current.length >= MAX_STUDENTS_PER_CLASS) return null;
    const id = generateStudentId(classId);
    const studentId = customStudentId?.trim() || `STU${Date.now().toString().slice(-6)}`;
    const newStudent = {
      id,
      studentId,
      name: name?.trim() || 'New Student',
      status: 'pending',
      photoUrl: null,
    };
    setStudentsByClass((prev) => {
      const list = prev[classId] || [];
      // console.log("list", list);
      if (list.length >= MAX_STUDENTS_PER_CLASS) return prev;
      return { ...prev, [classId]: [...list, newStudent] };
    });
    return newStudent;
  };

  const markNotificationRead = (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const addPendingUpload = (item) => setPendingUploads((p) => [...p, item]);
  const removePendingUpload = (id) => setPendingUploads((p) => p.filter((x) => x.id !== id));
  const clearPendingUploads = () => setPendingUploads([]);

  const value = {
    user,
    setUser,
    schools,
    classes: getClasses(),
    getClasses,
    getStudents,
    updateStudentStatus,
    addStudent,
    notifications,
    markNotificationRead,
    pendingUploads,
    addPendingUpload,
    removePendingUpload,
    clearPendingUploads,
    offlineMode,
    setOfflineMode,
    savedIdCards,
    getIdCardsForStudent,
    addSavedIdCard,
    getSavedIdCard,
    getAllSavedIdCards,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
