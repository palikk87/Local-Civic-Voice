import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const result = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name='GovernmentReference' 
    ORDER BY column_name
  `;
  console.log('Columns in database:');
  result.forEach(col => console.log(`  ${col.column_name}: ${col.data_type}`));
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await prisma.$disconnect();
}
