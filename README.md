# Qexam Teacher Android

Qexam Teacher Windows/웹 원본의 화면과 기능을 Android에서 사용할 수 있도록 Capacitor WebView 앱으로 패키징한 프로젝트입니다.

## 포함 기능

원본 React 앱의 AI 지문 분석, 쉬운 설명, 단어 시험, 워크북·교사용 답안지 생성, PDF/이미지/TXT 입력과 오프라인 OCR, 다중 페이지 편집기, `.qws` 프로젝트 열기·저장, PDF/PNG 내보내기, Gemini 모델·비용 설정을 그대로 포함합니다. Android에서는 브라우저 fallback을 사용하므로 파일 선택은 Android 파일 선택기, 저장·내보내기는 다운로드 동작으로 처리됩니다.

## 기술 스택

- React 19 + TypeScript + Vite
- Capacitor Android WebView
- Android application id: `com.qexam.teacher`
- Tesseract.js + PDF.js 오프라인 입력 처리
- Gemini API 직접 호출

## 개발 및 APK 빌드

```bash
npm ci
npm run dev
npm run build
npm run android:build
```

APK는 `android/app/build/outputs/apk/debug/app-debug.apk`에 생성됩니다. Android SDK 36, Build Tools 36, JDK 21이 필요합니다.

## GitHub Actions

`.github/workflows/build-android.yml`이 `main` push, Pull Request, 수동 실행 시 debug APK를 빌드하고 `qexam-teacher-android-debug` artifact로 업로드합니다.
