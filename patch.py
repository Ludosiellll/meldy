import sys

with open('backend/agents/base.py', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''                    GEMINI_MODELS = [
                        "gemini-3.1-flash-lite",
                        "gemini-2.5-flash-preview-05-20",
                        "gemini-2.0-flash",
                        "gemini-1.5-flash",
                    ]
                    
                    model_loaded = None
                    model_error = None
                    for model_name in GEMINI_MODELS:
                        try:
                            model_loaded = genai.GenerativeModel(model_name)
                            break
                        except Exception as e:
                            model_error = str(e)
                            continue
                    
                    if not model_loaded:
                        gemini_errors.append(f"Не удалось загрузить ни одну Gemini модель: {model_error}")
                        continue  # переходим к следующему ключу
                    
                    full_prompt = f"{system_prompt}\\n\\nЗАПРОС:\\n{truncated}"
                    
                    # Делаем запрос
                    response = await model_loaded.generate_content_async(
                        full_prompt,
                        generation_config=genai.types.GenerationConfig(
                            temperature=0.3,
                            max_output_tokens=8192,
                        ),
                        safety_settings=self.safety_settings
                    )
                    
                    if response and response.text:
                        return response.text
                    
                    gemini_errors.append(f"Key {key[:6]}... returned empty text")
                except Exception as e:
                    err_msg = str(e)
                    gemini_errors.append(f"Key {key[:6]}... error: {err_msg[:100]}")
                    continue'''

replacement = '''                    GEMINI_MODELS = [
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
                            full_prompt = f"{system_prompt}\\n\\nЗАПРОС:\\n{truncated}"
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
                    continue'''

if target in content:
    with open('backend/agents/base.py', 'w', encoding='utf-8') as f:
        f.write(content.replace(target, replacement))
    print('SUCCESS')
else:
    print('TARGET NOT FOUND')
