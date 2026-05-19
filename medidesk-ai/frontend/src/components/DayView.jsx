import React from 'react';

const DayView = ({ selectedDate, appointments }) => {
  const generateTimeSlots = () => {
    const slots = [];
    for (let hour = 8; hour <= 18; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    return slots;
  };

  const getAppointmentsForSlot = (time) => {
    const dateStr = selectedDate.toISOString().split('T')[0];
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

  const formatFullDate = () => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return selectedDate.toLocaleDateString('en-US', options);
  };

  const timeSlots = generateTimeSlots();

  return (
    <div className="day-view">
      <div className="day-view-header">
        <h2>{formatFullDate()}</h2>
      </div>
      
      <div className="day-view-grid">
        {timeSlots.map((time, timeIndex) => (
          <div key={time} className="day-time-slot">
            <div className="day-time-label">{time}</div>
            <div className="day-appointments-container">
              {getAppointmentsForSlot(time).map((appointment, aptIndex) => (
                <div
                  key={appointment.id || aptIndex}
                  className={`day-appointment ${getStatusClass(appointment.status)}`}
                >
                  <div className="day-appointment-patient">{appointment.patient_name}</div>
                  <div className="day-appointment-time">{appointment.start_time} – {appointment.end_time}</div>
                  <div className={`day-appointment-status ${getStatusClass(appointment.status)}`}>
                    {appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default React.memo(DayView);
