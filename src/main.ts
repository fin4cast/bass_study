import './styles.css';
import { mountApplication } from './app/application';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Не найден контейнер приложения #app.');
const application = mountApplication(root);

if (import.meta.hot) import.meta.hot.dispose(() => application.dispose().catch(error => {
  console.error('Не удалось сохранить все изменения перед обновлением страницы.', error);
}));
