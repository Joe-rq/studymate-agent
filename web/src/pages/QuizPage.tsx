import { useNavigate } from 'react-router-dom';
import QuizRunner from '../components/QuizRunner';

export default function QuizPage() {
  const navigate = useNavigate();

  return (
    <div>
      <h2 className="page-title">测验</h2>
      <QuizRunner
        onGraded={(payload) => {
          // 结果写入 sessionStorage，GradeReport 页读取展示
          sessionStorage.setItem('gradeResult', JSON.stringify(payload));
          navigate('/grade');
        }}
      />
    </div>
  );
}
