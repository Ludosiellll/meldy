path = r"frontend/src/pages/Career.tsx"

with open(path, "r", encoding="utf-8", errors="ignore") as f:
    content = f.read()

# Let's find where handleSendVacancyChatMessage ends and handleStartExpandChat starts
target = '''    } finally {
      setSendingVacancyChat(false);
    }
  const handleStartExpandChat = () => {'''

replacement = '''    } finally {
      setSendingVacancyChat(false);
    }
  };

  const handleStartExpandChat = () => {'''

content_clean = content.replace('\\r\\n', '\\n').replace('\\r', '')
target_clean = target.replace('\\r\\n', '\\n').replace('\\r', '')
replacement_clean = replacement.replace('\\r\\n', '\\n').replace('\\r', '')

if target_clean in content_clean:
    content_clean = content_clean.replace(target_clean, replacement_clean)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content_clean)
    print("SUCCESS FIXED BRACE")
else:
    print("TARGET NOT MATCHED")
