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
        <div key={`empty-${i}`} className="calendar-day empty">
          <span className="day-number other-month"></span>
        </div>
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
          className={`calendar-day ${isCurrentDay ? 'today' : ''} ${isCurrentSelected ? 'selected' : ''}`}
          onClick={() => handleDayClick(day)}
        >
          <span className={`day-number ${isCurrentDay || isCurrentSelected ? '' : 'other-month'}`}>
            {day}
          </span>
          {hasAppts && (
            <span className={`appointment-dot ${hasUrgent ? 'urgent' : ''}`}></span>
          )}
        </div>
      );
    }

    return days;
  };


  if (!currentMonth) {
    return (
      <div className="appointment-calendar">
        <div className="calendar-header">
          <h3>Loading...</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="appointment-calendar">
      <div className="calendar-header">
        <button className="calendar-nav-btn" onClick={handlePrevMonth}>
          ←
        </button>
        <h3>{MONTH_NAMES[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h3>
        <button className="calendar-nav-btn" onClick={handleNextMonth}>
          →
        </button>
      </div>
      
      <div className="calendar-grid">
        {/* Day headers */}
        {DAY_NAMES.map(day => (
          <div key={day} className="calendar-day-header">
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
