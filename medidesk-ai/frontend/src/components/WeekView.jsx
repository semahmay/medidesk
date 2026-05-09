import React from 'react';

const WeekView = ({ selectedDate, appointments, onDateSelect }) => {
  const getWeekDates = (date) => {
    const week = [];
    const start = new Date(date);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    start.setDate(diff);
    
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(start);
      currentDate.setDate(start.getDate() + i);
      week.push(currentDate);
    }
    
    return week;
  };

  const generateTimeSlots = () => {
    const slots = [];
    for (let hour = 8; hour <= 18; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    return slots;
  };

  const getAppointmentsForSlot = (date, time) => {
    const dateStr = date.toISOString().split('T')[0];
    return appointments.filter(apt => 
      apt.appointment_date === dateStr && 
      apt.start_time <= time && 
      apt.end_time > time
    );
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

  const isToday = (date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const weekDates = getWeekDates(selectedDate);
  const timeSlots = generateTimeSlots();
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="week-view">
      <div className="week-grid">
        {/* Header row */}
        <div className="time-column"></div>
        {weekDates.map((date, index) => (
          <div 
            key={index} 
            className={`day-column ${isToday(date) ? 'today' : ''}`}
            onClick={() => onDateSelect(date)}
          >
            <div className="day-header">
              <div className="day-name">{dayNames[index]}</div>
              <div className="day-number">{date.getDate()}</div>
            </div>
          </div>
        ))}
        
        {/* Time slots */}
        {timeSlots.map((time, timeIndex) => (
          <React.Fragment key={time}>
            {/* Time label */}
            <div className="time-slot">
              {time}
            </div>
            
            {/* Day columns for this time slot */}
            {weekDates.map((date, dayIndex) => (
              <div 
                key={`${timeIndex}-${dayIndex}`} 
                className="time-slot-cell"
              >
                {getAppointmentsForSlot(date, time).map((appointment, aptIndex) => (
                  <div 
                    key={appointment.id || aptIndex}
                    className={`appointment-block ${getStatusClass(appointment.status)}`}
                  >
                    {appointment.patient_name}
                  </div>
                ))}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default WeekView;
