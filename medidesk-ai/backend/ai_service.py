import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()


def chat_with_claude(message, patient_context=None):
    """
    Chat with Groq AI for medical assistance.
    Raises ValueError if GROQ_API_KEY is not set.
    """
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key:
        raise ValueError(
            "GROQ_API_KEY is not set. "
            "Add it to backend/.env to enable AI features."
        )

    client = Groq(api_key=api_key)

    user_message = "Doctor's Question: " + message

    if patient_context:
        system_prompt = f"""You are a concise medical AI assistant helping a doctor.
Patient information:
- Name: {patient_context.get('full_name')}
- Status: {patient_context.get('status')}
- Appointment: {patient_context.get('appointment')}
- Notes: {patient_context.get('notes')}

Rules:
- Answer ONLY what the doctor asked — nothing more
- Keep responses to 3-5 sentences maximum
- Do not add sections the doctor didn't ask for
- Do not use headers or bullet points unless specifically asked
- Be direct and clinical
- You assist the doctor, you do not replace them
"""
        custom_fields = ""
        for key, value in patient_context.items():
            if key not in ['full_name', 'phone', 'email', 'appointment', 'status', 'notes', 'attachments']:
                custom_fields += f"- {key}: {value}\n"
        if custom_fields:
            system_prompt += f"\nAdditional information:\n{custom_fields}"
    else:
        system_prompt = (
            "You are a concise medical AI assistant helping a doctor. "
            "Be direct and clinical. Keep responses to 3-5 sentences maximum."
        )

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        max_tokens=1000,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    )

    return response.choices[0].message.content
