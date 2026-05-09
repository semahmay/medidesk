import React from 'react';

const MonthView = ({ selectedDate, appointments, onDateSelect }) => {
  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getAppointmentsForDay = (day) => {
    const date = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
    const dateStr = date.toISOString().split('T')[0];
    return appointments.filter(apt => apt.appointment_date === dateStr);
  };

  const isToday = (day) => {
    const today = new Date();
    return day === today.getDate() && 
           selectedDate.getMonth() === today.getMonth() && 
           selectedDate.getFullYear() === today.getFullYear();
  };

  const handleDayClick = (day) => {
    const newDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
    onDateSelect(newDate);
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'confirmed':
        return 'status-confirmed';
      case 'pending':
        return 'status-pending';
      case 'urgent':
        return 'status-urgent';
      default:
        return 'status-pending';
    }
  };

  const daysInMonth = getDaysInMonth(selectedDate);
  const firstDay = getFirstDayOfMonth(selectedDate);
  const dayNames = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  // Calculate grid layout
  const startDay = firstDay === 0 ? 6 : firstDay - 1; // Convert Sunday (0) to Saturday (6)
  const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;

  return (
    <div className="month-view">
      <div className="month-grid">
        {/* Day headers */}
        {dayNames.map(day => (
          <div key={day} className="month-day-header">
            {day}
          </div>
        ))}
        
        {/* Calendar days */}
        {Array.from({ length: totalCells }, (_, index) => {
          const dayNumber = index - startDay + 1;
          const isValidDay = dayNumber > 0 && dayNumber <= daysInMonth;
          const dayAppointments = isValidDay ? getAppointmentsForDay(dayNumber) : [];
          const isCurrentDay = isValidDay && isToday(dayNumber);

          return (
            <div
              key={index}
              className={`month-day-cell ${isCurrentDay ? 'today' : ''} ${!isValidDay ? 'other-month' : ''}`}
              onClick={() => isValidDay && handleDayClick(dayNumber)}
            >
              {isValidDay && (
                <>
                  <div className="month-day-number">{dayNumber}</div>
                  <div className="month-day-appointments">
                    {dayAppointments.slice(0, 2).map((appointment, aptIndex) => (
                      <div
                        key={appointment.id || aptIndex}
                        className={`month-appointment ${getStatusClass(appointment.status)}`}
                      >
                        <div className="month-appointment-time">{appointment.start_time}</div>
                        <div className="month-appointment-patient">{appointment.patient_name}</div>
                      </div>
                    ))}
                    {dayAppointments.length > 2 && (
                      <div className="month-more-appointments">
                        +{dayAppointments.length - 2} more
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MonthView;
