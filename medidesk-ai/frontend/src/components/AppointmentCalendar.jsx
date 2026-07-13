import React, { useState, useEffect } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const AppointmentCalendar = ({ selectedDate, onDateSelect, appointments, onViewChange }) => {
  const [currentMonth, setCurrentMonth] = useState(null);

  useEffect(() => {
    // Initialize currentMonth when component mounts or selectedDate changes
    if (selectedDate) {
      setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate]);

  const getDaysInMonth = (date) => {
    if (!date) return 0;
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    if (!date) return 0;
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const formatDate = (date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  };

  const isToday = (day) => {
    if (!currentMonth) return false;
    const today = new Date();
    return day === today.getDate() && 
           currentMonth.getMonth() === today.getMonth() && 
           currentMonth.getFullYear() === today.getFullYear();
  };

  const isSelected = (day) => {
    if (!currentMonth || !selectedDate) return false;
    return day === selectedDate.getDate() && 
           currentMonth.getMonth() === selectedDate.getMonth() && 
           currentMonth.getFullYear() === selectedDate.getFullYear();
  };

  const hasAppointments = (day) => {
    if (!currentMonth || !appointments) return false;
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const dateStr = formatDate(date);
    return appointments.some(apt => apt.appointment_date === dateStr);
  };

  const hasUrgentAppointments = (day) => {
    if (!currentMonth || !appointments) return false;
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const dateStr = formatDate(date);
    return appointments.some(apt => apt.appointment_date === dateStr && apt.status === 'urgent');
  };

  const handlePrevMonth = () => {
    if (!currentMonth) return;
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    if (!currentMonth) return;
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const handleDayClick = (day) => {
    if (!currentMonth) return;
    const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    onDateSelect(newDate);
    // Switch to day view when a day is clicked
    if (onViewChange) {
      onViewChange('day');
    }
  };

  const renderCalendarDays = () => {
    if (!currentMonth) return null;
    
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDay = getFirstDayOfMonth(currentMonth);
    const days = [];

    // Add empty cells for days before month starts
    const startDay = firstDay === 0 ? 6 : firstDay - 1; // Convert Sunday (0) to Saturday (6)
    for (let i = 0; i < startDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="cal-month-cell empty"></div>
      );
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const isCurrentDay = isToday(day);
      const isCurrentSelected = isSelected(day);
      const hasAppts = hasAppointments(day);
      const hasUrgent = hasUrgentAppointments(day);

      days.push(
        <div 
          key={day} 
          className={`cal-month-cell ${isCurrentDay || isCurrentSelected ? '' : ''}`}
          onClick={() => handleDayClick(day)}
        >
          <span className={`cal-month-day ${isCurrentDay ? 'today' : ''} ${isCurrentSelected ? 'selected' : ''}`}>
            {day}
          </span>
          {hasAppts && (
            <span className={`cal-month-dot ${hasUrgent ? 'urgent' : ''}`}></span>
          )}
        </div>
      );
    }

    return days;
  };


  if (!currentMonth) {
    return (
      <div className="cal-month-card">
        <div className="cal-month-header">
          <h3>Loading...</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="cal-month-card">
      <div className="cal-month-header">
        <button className="btn btn-ghost" onClick={handlePrevMonth} aria-label="Previous month">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h3>{MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h3>
        <button className="btn btn-ghost" onClick={handleNextMonth} aria-label="Next month">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      
      <div className="cal-month-grid">
        {/* Day headers */}
        {DAY_NAMES.map(day => (
          <div key={day} className="cal-month-day-header">
            {day}
          </div>
        ))}
        
        {/* Calendar days */}
        {renderCalendarDays()}
      </div>
    </div>
  );
};

export default AppointmentCalendar;
