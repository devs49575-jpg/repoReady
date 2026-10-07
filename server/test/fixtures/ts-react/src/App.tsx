import { Button } from './components/Button';

const API = import.meta.env.VITE_API_URL;
const mode = import.meta.env.MODE;

export default function App() {
  return <Button label={`${API} ${mode}`} />;
}
