import { createContext, useContext, useState, useCallback } from 'react';

// ── Translations ──────────────────────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    // Nav
    'nav.dashboard':        'Dashboard',
    'nav.patients':         'Patients',
    'nav.appointments':     'Appointments',
    'nav.chat':             'Chat',
    'nav.medical':          'Medical Reference',
    'nav.analytics':        'Analytics',
    'nav.settings':         'Settings',
    // Dashboard
    'dash.greeting.morning':   'Good morning',
    'dash.greeting.afternoon': 'Good afternoon',
    'dash.greeting.evening':   'Good evening',
    'dash.today_appts':        "Today's appointments",
    'dash.waiting':            'Waiting patients',
    'dash.total_patients':     'Total patients',
    'dash.urgent':             'Urgent cases',
    'dash.upcoming':           'Upcoming appointments',
    'dash.no_appts':           'No appointments scheduled for today',
    'dash.recent_activity':    'Recent activity',
    'dash.no_activity':        'No recent activity',
    'dash.ai_title':           'AI assistant',
    'dash.ai_sub':             'Ask about patients, draft prescriptions, or check drug interactions right here.',
    'dash.recently_viewed':    'Recently viewed',
    'dash.no_recent':          'No recently viewed patients',
    'dash.ask_ai':             'Ask AI assistant',
    // Patients
    'patients.title':          'Patients',
    'patients.add':            'Add patient',
    'patients.search':         'Search patients…',
    'patients.total':          'Total',
    'patients.active':         'Active',
    'patients.followup':       'Follow-up',
    'patients.urgent':         'Urgent',
    'patients.no_patients':    'No patients yet',
    'patients.no_patients_sub':'Add your first patient to get started',
    // Patient detail
    'pd.export':               'Export',
    'pd.prescription':         'Prescription',
    'pd.generating':           'Generating…',
    'pd.overview':             'Overview',
    'pd.vitals':               'Vitals',
    'pd.timeline':             'Timeline',
    'pd.appointments':         'Appointments',
    'pd.files':                'Files',
    'pd.notes':                'Notes',
    'pd.phone':                'Phone',
    'pd.email':                'Email',
    'pd.appointment':          'Appointment',
    'pd.not_scheduled':        'Not scheduled',
    'pd.no_notes':             'No clinical notes recorded.',
    'pd.edit_notes':           'Edit notes',
    'pd.add_file':             'Add file',
    'pd.voice_recording':      'Voice Recording',
    'pd.ai_assistant':         'AI Assistant',
    'pd.no_patient':           'No Patient Selected',
    'pd.no_patient_sub':       'Select a patient from the list to view their details',
    'pd.vital_signs':          'Vital Signs',
    'pd.add_record':           'Add record',
    'pd.no_vitals':            'No vital signs recorded yet.',
    'pd.no_appts':             'No appointments found',
    'pd.no_files':             'No files uploaded yet.',
    // Appointments
    'appts.title':             'Appointments',
    'appts.new':               'New appointment',
    'appts.month':             'Month',
    'appts.week':              'Week',
    'appts.day':               'Day',
    'appts.no_appts':          'No appointments scheduled',
    // Medical reference
    'mr.title':                'Medical Reference',
    'mr.sub':                  'AI-powered clinical knowledge base',
    'mr.placeholder':          'Ask any medical question — dosages, interactions, protocols…',
    'mr.empty_title':          'What do you want to look up?',
    'mr.empty_sub':            'Ask about dosages, drug interactions, symptoms, or protocols',
    'mr.clear':                'Clear',
    // Chat
    'chat.title':              'Clinic Chat',
    'chat.all':                'All',
    'chat.tasks':              'Tasks',
    'chat.no_messages':        'No messages yet. Start the conversation.',
    'chat.no_tasks':           'No tasks yet',
    'chat.placeholder_msg':    'Message as',
    'chat.placeholder_task':   'Describe a task for the other person…',
    'chat.mark_done':          'Mark as done',
    // Notes editor
    'notes.title':             'Clinical Notes',
    'notes.placeholder':       'Start typing clinical notes… or use the voice button below.',
    'notes.words':             'words',
    'notes.chars':             'chars',
    'notes.save':              'Save notes',
    'notes.saving':            'Saving…',
    'notes.saved':             'Saved',
    'notes.close':             'Close',
    'notes.voice':             'Voice',
    'notes.stop':              'Stop',
    // Patient form
    'form.add_patient':        'Add New Patient',
    'form.edit_patient':       'Edit Patient',
    'form.full_name':          'Full Name',
    'form.phone':              'Phone',
    'form.email':              'Email',
    'form.appointment_date':   'Appointment Date',
    'form.status':             'Status',
    'form.notes':              'Notes',
    'form.notes_required':     '(required)',
    'form.cancel':             'Cancel',
    'form.save':               'Save Patient',
    'form.save_changes':       'Save Changes',
    'form.quick_save':         'Quick Save',
    'form.saving':             'Saving…',
    'form.quick_mode':         'Enable Quick Mode',
    'form.quick_mode_on':      'Quick Mode — ON',
    // Common
    'common.loading':          'Loading…',
    'common.doctor':           'Doctor',
    'common.secretary':        'Secretary',
    'common.done':             'Done',
    'common.task':             'Task',
    'common.today':            'Today',
    'common.synced':           'Synced',
    'common.syncing':          'Syncing',
  },

  fr: {
    // Nav
    'nav.dashboard':        'Tableau de bord',
    'nav.patients':         'Patients',
    'nav.appointments':     'Rendez-vous',
    'nav.chat':             'Chat',
    'nav.medical':          'Référence médicale',
    'nav.analytics':        'Analytique',
    'nav.settings':         'Paramètres',
    // Dashboard
    'dash.greeting.morning':   'Bonjour',
    'dash.greeting.afternoon': 'Bon après-midi',
    'dash.greeting.evening':   'Bonsoir',
    'dash.today_appts':        "Rendez-vous aujourd'hui",
    'dash.waiting':            'Patients en attente',
    'dash.total_patients':     'Total patients',
    'dash.urgent':             'Cas urgents',
    'dash.upcoming':           'Prochains rendez-vous',
    'dash.no_appts':           "Aucun rendez-vous aujourd'hui",
    'dash.recent_activity':    'Activité récente',
    'dash.no_activity':        'Aucune activité récente',
    'dash.ai_title':           'Assistant IA',
    'dash.ai_sub':             'Posez des questions sur les patients, rédigez des ordonnances ou vérifiez les interactions médicamenteuses.',
    'dash.recently_viewed':    'Récemment consultés',
    'dash.no_recent':          'Aucun patient récemment consulté',
    'dash.ask_ai':             'Demander à l\'IA',
    // Patients
    'patients.title':          'Patients',
    'patients.add':            'Ajouter un patient',
    'patients.search':         'Rechercher des patients…',
    'patients.total':          'Total',
    'patients.active':         'Actif',
    'patients.followup':       'Suivi',
    'patients.urgent':         'Urgent',
    'patients.no_patients':    'Aucun patient',
    'patients.no_patients_sub':'Ajoutez votre premier patient pour commencer',
    // Patient detail
    'pd.export':               'Exporter',
    'pd.prescription':         'Ordonnance',
    'pd.generating':           'Génération…',
    'pd.overview':             'Aperçu',
    'pd.vitals':               'Constantes',
    'pd.timeline':             'Historique',
    'pd.appointments':         'Rendez-vous',
    'pd.files':                'Fichiers',
    'pd.notes':                'Notes',
    'pd.phone':                'Téléphone',
    'pd.email':                'E-mail',
    'pd.appointment':          'Rendez-vous',
    'pd.not_scheduled':        'Non planifié',
    'pd.no_notes':             'Aucune note clinique enregistrée.',
    'pd.edit_notes':           'Modifier les notes',
    'pd.add_file':             'Ajouter un fichier',
    'pd.voice_recording':      'Enregistrement vocal',
    'pd.ai_assistant':         'Assistant IA',
    'pd.no_patient':           'Aucun patient sélectionné',
    'pd.no_patient_sub':       'Sélectionnez un patient dans la liste pour voir ses détails',
    'pd.vital_signs':          'Signes vitaux',
    'pd.add_record':           'Ajouter un enregistrement',
    'pd.no_vitals':            'Aucun signe vital enregistré.',
    'pd.no_appts':             'Aucun rendez-vous trouvé',
    'pd.no_files':             'Aucun fichier téléchargé.',
    // Appointments
    'appts.title':             'Rendez-vous',
    'appts.new':               'Nouveau rendez-vous',
    'appts.month':             'Mois',
    'appts.week':              'Semaine',
    'appts.day':               'Jour',
    'appts.no_appts':          'Aucun rendez-vous planifié',
    // Medical reference
    'mr.title':                'Référence médicale',
    'mr.sub':                  'Base de connaissances cliniques alimentée par IA',
    'mr.placeholder':          'Posez toute question médicale — dosages, interactions, protocoles…',
    'mr.empty_title':          'Que souhaitez-vous rechercher ?',
    'mr.empty_sub':            'Posez des questions sur les dosages, interactions, symptômes ou protocoles',
    'mr.clear':                'Effacer',
    // Chat
    'chat.title':              'Chat Clinique',
    'chat.all':                'Tous',
    'chat.tasks':              'Tâches',
    'chat.no_messages':        'Aucun message. Démarrez la conversation.',
    'chat.no_tasks':           'Aucune tâche',
    'chat.placeholder_msg':    'Message en tant que',
    'chat.placeholder_task':   'Décrivez une tâche pour l\'autre personne…',
    'chat.mark_done':          'Marquer comme fait',
    // Notes editor
    'notes.title':             'Notes cliniques',
    'notes.placeholder':       'Commencez à taper des notes cliniques… ou utilisez le bouton vocal ci-dessous.',
    'notes.words':             'mots',
    'notes.chars':             'caractères',
    'notes.save':              'Enregistrer les notes',
    'notes.saving':            'Enregistrement…',
    'notes.saved':             'Enregistré',
    'notes.close':             'Fermer',
    'notes.voice':             'Vocal',
    'notes.stop':              'Stop',
    // Patient form
    'form.add_patient':        'Ajouter un patient',
    'form.edit_patient':       'Modifier le patient',
    'form.full_name':          'Nom complet',
    'form.phone':              'Téléphone',
    'form.email':              'E-mail',
    'form.appointment_date':   'Date du rendez-vous',
    'form.status':             'Statut',
    'form.notes':              'Notes',
    'form.notes_required':     '(obligatoire)',
    'form.cancel':             'Annuler',
    'form.save':               'Enregistrer le patient',
    'form.save_changes':       'Enregistrer les modifications',
    'form.quick_save':         'Sauvegarde rapide',
    'form.saving':             'Enregistrement…',
    'form.quick_mode':         'Activer le mode rapide',
    'form.quick_mode_on':      'Mode rapide — ACTIVÉ',
    // Common
    'common.loading':          'Chargement…',
    'common.doctor':           'Médecin',
    'common.secretary':        'Secrétaire',
    'common.done':             'Fait',
    'common.task':             'Tâche',
    'common.today':            "Aujourd'hui",
    'common.synced':           'Synchronisé',
    'common.syncing':          'Synchronisation',
  },
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'en');

  const setLanguage = useCallback((l) => {
    setLang(l);
    localStorage.setItem('lang', l);
    document.documentElement.setAttribute('lang', l);
  }, []);

  const t = useCallback((key, fallback) => {
    return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS['en']?.[key] ?? fallback ?? key;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
