    async def run(self, system_prompt: str, user_text: str) -> str:
        max_chars = 300000 if self.gemini_keys else 80000
        truncated = user_text[:max_chars]
        if len(user_text) > max_chars:
            truncated += f"\n\n[Текст сокращен с {len(user_text)} до {max_chars} символов]"

        gemini_errors = []

        if self.gemini_keys:
            shuffled_keys = list(self.gemini_keys)
            import random
            random.shuffle(shuffled_keys)
            
            for key in shuffled_keys:
                try:
                    genai.configure(api_key=key)
                    GEMINI_MODELS = [
                        "gemini-3.1-flash-lite",
                        "gemini-3-flash-preview",
                        "gemini-3.1-pro-preview",
                        "gemini-2.5-flash",
                        "gemini-2.0-flash",
                        "gemini-1.5-flash",
                    ]
                    
                    response_text = None
                    last_err = None
                    
                    for model_name in GEMINI_MODELS:
                        try:
                            model_loaded = genai.GenerativeModel(model_name)
                            full_prompt = f"{system_prompt}\n\nЗАПРОС:\n{truncated}"
                            response = await model_loaded.generate_content_async(
                                full_prompt,
                                generation_config=genai.types.GenerationConfig(
                                    temperature=0.3,
                                    max_output_tokens=8192,
                                ),
                                safety_settings=self.safety_settings
                            )
                            if response and response.text:
                                response_text = response.text
                                break
                        except Exception as e:
                            last_err = str(e)
                            continue
                            
                    if response_text:
                        return response_text
                        
                    gemini_errors.append(f"Key {key[:6]}... error: {last_err[:100] if last_err else 'No text'}")
                    continue
                except Exception as e:
                    gemini_errors.append(f"Key {key[:6]}... fatal error: {str(e)[:100]}")
                    continue

        if self.groq_client:
            try:
                response = await self.groq_client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": truncated},
                    ],
                    temperature=0.3,
                    max_tokens=8192,
                )
                return response.choices[0].message.content or ""
            except Exception as e:
                groq_err = str(e)
                if "429" in groq_err:
                    debug_info = "\n".join(gemini_errors) if gemini_errors else "Ключи Gemini не найдены"
                    return f"Ошибка: Лимиты ИИ исчерпаны.\n\nGemini ошибки:\n{debug_info}\n\nGroq ошибка: 429."
                return f"Ошибка ИИ (Groq): {groq_err}"
        
        return "Ошибка: API ключи не настроены."
